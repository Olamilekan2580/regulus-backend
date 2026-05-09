const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');
const stripe = require('stripe'); // Make sure you ran npm install stripe

// 1. GET: Fetch client portal data
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select(`
        id, name, company, email, org_id,
        organizations ( name, brand_settings, payment_settings )
      `)
      .eq('portal_token', token)
      .single();

    if (clientError || !client) return res.status(404).json({ error: 'Invalid portal link' });

    const [projectsRes, invoicesRes, proposalsRes] = await Promise.all([
      supabaseAdmin.from('projects').select('*').eq('client_id', client.id).order('created_at', { ascending: false }),
      supabaseAdmin.from('invoices').select('*').eq('client_id', client.id).order('created_at', { ascending: false }),
      supabaseAdmin.from('proposals').select('*').eq('client_id', client.id).order('created_at', { ascending: false })
    ]);

    const orgData = client.organizations || {};
    const brandSettings = orgData.brand_settings || {};
    const paymentSettings = orgData.payment_settings || {};

    res.status(200).json({
      client: { id: client.id, name: client.name, company: client.company, email: client.email },
      projects: projectsRes.data || [],
      invoices: invoicesRes.data || [],
      proposals: proposalsRes.data || [],
      settings: {
        brand_name: orgData.name || 'Regulus.',
        brand_color: brandSettings.primary || '#0A0F1E',
        accent_color: brandSettings.accent || '#00C896',
        provider: paymentSettings.provider || null,
        paystack_public_key: paymentSettings.paystack_pk || null
        // Notice we DO NOT send the Stripe Public Key. Stripe Checkout doesn't need it on the frontend.
      }
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to load client portal' });
  }
});

// 2. PUT: Handle Proposal Status
router.put('/proposals/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['Approved', 'Rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const { data, error } = await supabaseAdmin.from('proposals').update({ status }).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update proposal' });
  }
});

// ------------------------------------------------------------------
// PAYSTACK: VERIFY TRANSACTION
// ------------------------------------------------------------------
router.post('/invoices/:id/verify-paystack', async (req, res) => {
  try {
    const { reference } = req.body;
    const { id } = req.params;

    const { data: invoice } = await supabaseAdmin.from('invoices').select(`id, clients(organizations(payment_settings))`).eq('id', id).single();
    const secretKey = invoice?.clients?.organizations?.payment_settings?.paystack_sk;
    
    if (!secretKey) return res.status(400).json({ error: 'Gateway not configured.' });

    const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${secretKey}` }
    });
    const paystackData = await paystackRes.json();

    if (paystackData.status === true && paystackData.data.status === 'success') {
      await supabaseAdmin.from('invoices').update({ status: 'Paid' }).eq('id', id);
      return res.status(200).json({ message: 'Paid' });
    } else {
      return res.status(400).json({ error: 'Verification failed' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ------------------------------------------------------------------
// STRIPE: CREATE CHECKOUT SESSION
// ------------------------------------------------------------------
router.post('/invoices/:id/stripe-checkout', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: invoice } = await supabaseAdmin
      .from('invoices')
      .select(`*, clients ( portal_token, organizations ( payment_settings ) )`)
      .eq('id', id)
      .single();

    const secretKey = invoice?.clients?.organizations?.payment_settings?.stripe_sk;
    if (!secretKey) return res.status(400).json({ error: 'Stripe is not configured.' });

    // Initialize Stripe dynamically with this specific freelancer's key
    const stripeClient = stripe(secretKey);
    const portalUrl = `${req.headers.origin}/portal/${invoice.clients.portal_token}`;

    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Invoice ${invoice.invoice_number}` },
          unit_amount: Math.round(invoice.total * 100), // USD to cents
        },
        quantity: 1,
      }],
      mode: 'payment',
      // If successful, bounce them back to the portal with these URL parameters
      success_url: `${portalUrl}?success=true&invoice_id=${id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${portalUrl}?canceled=true`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
// STRIPE: VERIFY TRANSACTION AFTER REDIRECT
// ------------------------------------------------------------------
router.post('/invoices/:id/verify-stripe', async (req, res) => {
  try {
    const { session_id } = req.body;
    const { id } = req.params;

    const { data: invoice } = await supabaseAdmin.from('invoices').select(`id, clients(organizations(payment_settings))`).eq('id', id).single();
    const secretKey = invoice?.clients?.organizations?.payment_settings?.stripe_sk;

    const stripeClient = stripe(secretKey);
    const session = await stripeClient.checkout.sessions.retrieve(session_id);

    if (session.payment_status === 'paid') {
      await supabaseAdmin.from('invoices').update({ status: 'Paid' }).eq('id', id);
      return res.status(200).json({ message: 'Paid' });
    }
    return res.status(400).json({ error: 'Not paid' });
  } catch (err) {
    res.status(500).json({ error: 'Verification failed' });
  }
});

module.exports = router;