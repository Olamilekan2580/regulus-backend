const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const axios = require('axios'); // Needed to verify Paystack transactions
const crypto = require('crypto'); // Needed for the Vault

// Crypto Configuration
const ALGORITHM = 'aes-256-cbc';
const getEncryptionKey = () => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('CRITICAL: ENCRYPTION_KEY is missing from environment variables.');
  return Buffer.from(key, 'hex');
};

// ==========================================
// 1. FETCH PORTAL DATA (Upgraded to org_id)
// ==========================================
router.get('/portal/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;

    const { data: client, error: clientErr } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();
      
    if (clientErr || !client) return res.status(404).json({ error: 'Portal not found' });

    const [projectRes, invoiceRes, settingsRes, proposalRes] = await Promise.all([
      supabaseAdmin.from('projects').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
      supabaseAdmin.from('invoices').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
      supabaseAdmin.from('organizations').select('paystack_public_key, brand_name, brand_color, provider').eq('id', client.org_id).single(),
      supabaseAdmin.from('proposals').select('*, projects(name)').eq('client_id', clientId).order('created_at', { ascending: false })
    ]);

    res.status(200).json({
      client,
      projects: projectRes.data || [],
      invoices: invoiceRes.data || [],
      proposals: proposalRes.data || [],
      settings: settingsRes.data || { brand_name: 'Regulus', brand_color: '#1E293B', provider: null }
    });
  } catch (err) {
    console.error('[Public Portal Error]:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==========================================
// 2. PROPOSAL STATUS UPDATE (Basic Accept/Reject)
// ==========================================
router.put('/proposals/:proposalId/status', async (req, res) => {
  try {
    const { proposalId } = req.params;
    const { status } = req.body; 

    if (!['Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status update' });
    }

    const { data, error } = await supabaseAdmin
      .from('proposals')
      .update({ status })
      .eq('id', proposalId)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update proposal status' });
  }
});

// ==========================================
// 3. STRIPE CHECKOUT GENERATORS
// ==========================================
router.post('/proposals/:id/stripe-checkout', async (req, res) => {
  try {
    const { data: proposal } = await supabaseAdmin.from('proposals').select('*, clients(email)').eq('id', req.params.id).single();
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: proposal.clients?.email,
      line_items: [{
        price_data: { currency: 'usd', product_data: { name: `Proposal: ${proposal.title}` }, unit_amount: Math.round(parseFloat(proposal.price) * 100) },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/portal/${proposal.client_id}?success=true&proposal_id=${proposal.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/portal/${proposal.client_id}`,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: 'Failed to initialize Stripe' });
  }
});

router.post('/invoices/:id/stripe-checkout', async (req, res) => {
  try {
    const { data: invoice } = await supabaseAdmin.from('invoices').select('*, clients(email)').eq('id', req.params.id).single();
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: invoice.clients?.email,
      line_items: [{
        price_data: { currency: (invoice.currency || 'usd').toLowerCase(), product_data: { name: `Invoice: ${invoice.invoice_number}` }, unit_amount: Math.round(parseFloat(invoice.total) * 100) },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/portal/${invoice.client_id}?success=true&invoice_id=${invoice.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/portal/${invoice.client_id}`,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: 'Failed to initialize Stripe' });
  }
});

// ==========================================
// 4. SECURE PAYMENT VERIFICATION WEBHOOKS
// ==========================================
router.post('/invoices/:id/verify-stripe', async (req, res) => {
  try {
    const { session_id } = req.body;
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status === 'paid') {
      await supabaseAdmin.from('invoices').update({ status: 'Paid' }).eq('id', req.params.id);
      return res.json({ success: true });
    }
    res.status(400).json({ error: 'Payment not completed' });
  } catch (err) {
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.post('/invoices/:id/verify-paystack', async (req, res) => {
  try {
    const { reference } = req.body;
    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    if (response.data.data.status === 'success') {
      await supabaseAdmin.from('invoices').update({ status: 'Paid' }).eq('id', req.params.id);
      return res.json({ success: true });
    }
    res.status(400).json({ error: 'Payment not successful on Paystack' });
  } catch (err) {
    res.status(500).json({ error: 'Paystack Verification failed' });
  }
});

router.post('/proposals/:id/verify-stripe', async (req, res) => {
  try {
    const { session_id } = req.body;
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status === 'paid') {
      await supabaseAdmin.from('proposals').update({ status: 'Approved' }).eq('id', req.params.id);
      return res.json({ success: true });
    }
    res.status(400).json({ error: 'Payment not completed' });
  } catch (err) {
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.post('/proposals/:id/verify-paystack', async (req, res) => {
  try {
    const { reference } = req.body;
    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    if (response.data.data.status === 'success') {
      await supabaseAdmin.from('proposals').update({ status: 'Approved' }).eq('id', req.params.id);
      return res.json({ success: true });
    }
    res.status(400).json({ error: 'Payment not successful on Paystack' });
  } catch (err) {
    res.status(500).json({ error: 'Paystack Verification failed' });
  }
});

// ==========================================
// 5. PUBLIC VAULT REVEAL (Burn-on-Read)
// ==========================================
router.post('/vault/:id/reveal', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: secretData, error } = await supabaseAdmin
      .from('credential_vault')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !secretData) return res.status(404).json({ error: 'Secret not found or already destroyed.' });

    if (new Date() > new Date(secretData.expires_at)) {
      await supabaseAdmin.from('credential_vault').delete().eq('id', id);
      return res.status(410).json({ error: 'This secret has expired and was destroyed.' });
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(secretData.iv, 'hex'));
    let decryptedValue = decipher.update(secretData.encrypted_value, 'hex', 'utf8');
    decryptedValue += decipher.final('utf8');

    if (secretData.requires_burn) {
      await supabaseAdmin.from('credential_vault').delete().eq('id', id);
    } else {
      await supabaseAdmin.from('credential_vault').update({ is_viewed: true }).eq('id', id);
    }

    res.status(200).json({ 
      secret_name: secretData.secret_name, 
      secret_value: decryptedValue,
      burned: secretData.requires_burn 
    });
  } catch (err) {
    console.error('[Vault Reveal Error]:', err.message);
    res.status(500).json({ error: 'Decryption sequence failed.' });
  }
});

module.exports = router;