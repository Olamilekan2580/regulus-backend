const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');
const axios = require('axios');
const crypto = require('crypto');

/**
 * @fileoverview ENTERPRISE PUBLIC GATEWAY
 * @architecture Flutterwave-Native, Zero-Trust, Token-Validated
 * Handles: Public Portals, Proposals, Vaults, Intake, and Smart Checkout.
 */

// --- SECURITY CONFIGURATION ---
const ALGORITHM = 'aes-256-cbc';
const getEncryptionKey = () => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('CRITICAL: ENCRYPTION_KEY is missing from environment variables.');
  return Buffer.from(key, 'hex');
};

// ==========================================
// 1. PUBLIC PORTAL ENGINE (Multi-Tenant)
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
      supabaseAdmin.from('organizations').select('brand_name, brand_settings').eq('id', client.org_id).single(),
      supabaseAdmin.from('proposals').select('*, projects(name)').eq('client_id', clientId).order('created_at', { ascending: false })
    ]);

    res.status(200).json({
      client,
      projects: projectRes.data || [],
      invoices: invoiceRes.data || [],
      proposals: proposalRes.data || [],
      settings: settingsRes.data || { brand_name: 'Regulus', brand_settings: {} }
    });
  } catch (err) {
    console.error('[Public Portal Error]:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==========================================
// 2. PROPOSAL STATUS UPDATE
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
      .update({ status, updated_at: new Date().toISOString() })
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
// 3. SECURE CREDENTIAL VAULT (Burn-on-Read)
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
      await supabaseAdmin.from('credential_vault').update({ is_viewed: true, last_viewed_at: new Date().toISOString() }).eq('id', id);
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

// ==========================================
// 4. ASYNC CLIENT INTAKE & UPDATES 
// ==========================================
router.get('/intake/:token', async (req, res) => {
  try {
    const { data: project, error } = await supabaseAdmin
      .from('projects')
      .select('id, name, description, intake_submitted, clients(name, company, org_id)')
      .eq('intake_token', req.params.token)
      .single();

    if (error || !project) return res.status(404).json({ error: 'Invalid or expired intake link.' });
    
    // 🔒 LIFECYCLE GATE: Prevent modification of locked briefs
    if (project.intake_submitted) {
      return res.status(403).json({ error: 'Project brief has already been locked and submitted.' });
    }

    // Fetch organization branding so the public intake page looks professional
    let orgBranding = { name: 'Regulus Workspace', brand_settings: {} };
    if (project.clients?.org_id) {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('name, brand_settings')
        .eq('id', project.clients.org_id)
        .single();
      if (org) orgBranding = org;
    }

    res.status(200).json({ project, organization: orgBranding });
  } catch (err) {
    console.error('[Public Intake GET Error]:', err.message);
    res.status(500).json({ error: 'Failed to load intake portal.' });
  }
});

router.post('/intake/:token', async (req, res) => {
  const { requirements, assets = [] } = req.body; 
  
  if (!requirements) {
    return res.status(400).json({ error: 'Project brief is mandatory.' });
  }
  
  try {
    const { data: project, error: fetchErr } = await supabaseAdmin
      .from('projects')
      .select('id, intake_submitted')
      .eq('intake_token', req.params.token)
      .single();

    if (fetchErr || !project) return res.status(404).json({ error: 'Invalid link.' });
    
    // 🔒 PREVENT DOUBLE SUBMISSION
    if (project.intake_submitted) return res.status(403).json({ error: 'Project brief is already locked.' });

    // ATOMIC PROMOTION: Save requirements and move to "In Progress"
    const { error: updateErr } = await supabaseAdmin
      .from('projects')
      .update({ 
        client_requirements: requirements,
        project_assets: assets,
        intake_submitted: true, 
        status: 'In Progress', 
        intake_submitted_at: new Date().toISOString()
      })
      .eq('id', project.id);

    if (updateErr) throw updateErr;

    res.json({ success: true, message: 'Requirements securely transmitted and project started.' });
  } catch (err) {
    console.error('[Public Intake POST Error]:', err.message);
    res.status(500).json({ error: 'Failed to submit project details.' });
  }
});

router.get('/updates/:token', async (req, res) => {
  try {
    const { data: project, error: projErr } = await supabaseAdmin
      .from('projects')
      .select('id, name, status, deadline, clients(name, company)')
      .eq('update_token', req.params.token)
      .single();

    if (projErr || !project) return res.status(404).json({ error: 'Invalid timeline link.' });

    const { data: updates, error: updateErr } = await supabaseAdmin
      .from('project_updates')
      .select('*')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false });

    if (updateErr) throw updateErr;

    res.json({ project, updates });
  } catch (err) {
    console.error('[Public Timeline GET Error]:', err.message);
    res.status(500).json({ error: 'Failed to load project timeline.' });
  }
});

// ==========================================
// 5. DOMAIN LOOKUP
// ==========================================
router.get('/public/domain-lookup', async (req, res) => {
  const { domain } = req.query;
  if (!domain) return res.status(400).json({ error: 'Domain required' });

  try {
    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .select('id, name, brand_settings')
      .eq('custom_domain', domain)
      .eq('domain_status', 'active') 
      .single();

    if (error || !org) return res.status(404).json({ error: 'Domain not found or inactive' });

    res.status(200).json(org);
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed' });
  }
});

// ==========================================
// 6. MULTI-CURRENCY SMART CHECKOUT (FLUTTERWAVE)
// ==========================================
router.get('/invoices/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: invoice, error: invError } = await supabaseAdmin
      .from('invoices')
      .select('*, clients(*)')
      .eq('id', id)
      .single();

    if (invError || !invoice) return res.status(404).json({ error: 'Invoice not found.' });

    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('name, brand_settings, default_payout_currency, fw_subaccount_ngn, fw_subaccount_usd')
      .eq('id', invoice.org_id)
      .single();

    if (orgError) throw orgError;

    res.status(200).json({ invoice, org });
  } catch (err) {
    console.error('[Public Invoice Fetch Error]:', err.message);
    res.status(500).json({ error: 'Failed to load checkout details.' });
  }
});

router.post('/invoices/:id/flutterwave-checkout', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: invoice } = await supabaseAdmin.from('invoices').select('*, clients(*)').eq('id', id).single();
    const { data: org } = await supabaseAdmin.from('organizations').select('*').eq('id', invoice.org_id).single();

    if (!invoice || !org) return res.status(404).json({ error: 'Transaction data missing.' });

    const currency = invoice.currency || 'NGN';
    let subaccountId = (currency === 'NGN') ? org.fw_subaccount_ngn : org.fw_subaccount_usd;

    if (!subaccountId) {
      subaccountId = (org.default_payout_currency === 'NGN') ? org.fw_subaccount_ngn : org.fw_subaccount_usd;
    }

    if (!subaccountId) {
      return res.status(400).json({ error: 'This freelancer has not connected a payout vault for this currency.' });
    }

    const flwPayload = {
      tx_ref: `regulus-inv-${invoice.id}-${Date.now()}`,
      amount: invoice.total,
      currency: currency,
      redirect_url: `${process.env.FRONTEND_URL}/pay/success?invoice_id=${invoice.id}`,
      customer: {
        email: invoice.clients?.email,
        name: invoice.clients?.name,
      },
      customizations: {
        title: org.name || "Regulus Freelancer",
        description: `Payment for Invoice #${invoice.invoice_number}`,
        logo: "https://your-logo-url.com/logo.png",
      },
      subaccounts: [
        {
          id: subaccountId,
          transaction_charge_type: "percentage",
          transaction_charge: 1 
        }
      ]
    };

    const response = await axios.post(
      'https://api.flutterwave.com/v3/payments',
      flwPayload,
      { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` } }
    );

    res.json({ url: response.data.data.link });

  } catch (err) {
    console.error('[FLW Checkout Error]:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to initialize payment gateway.' });
  }
});

module.exports = router;