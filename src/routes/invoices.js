const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');
const { getExchangeRate } = require('../services/currencyService');

const authModule = require('../middleware/auth');
const requireAuth = typeof authModule === 'function' ? authModule : authModule.requireAuth;

router.use(requireAuth);

// 1. GET ALL INVOICES
router.get('/', async (req, res) => {
  const orgId = req.headers['x-org-id'] || req.query.org_id;
  if (!orgId) return res.status(400).json({ error: 'Organization context missing' });

  try {
    const { data, error } = await supabaseAdmin
      .from('invoices')
      .select('*, clients(*)') 
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json(data || []);
  } catch (err) {
    console.error('[Invoices GET Error]:', err.message);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// 2. CREATE INVOICE
router.post('/', async (req, res) => {
  const orgId = req.headers['x-org-id'] || req.body.org_id;
  if (!orgId) return res.status(400).json({ error: 'Organization ID missing' });

  try {
    const { client_id, invoice_number, total, status, due_date, currency, line_items } = req.body;

    // SECURITY CHECK: Verify client belongs to this Org
    const { data: clientCheck, error: clientErr } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('id', client_id)
      .eq('org_id', orgId)
      .single();

    if (clientErr || !clientCheck) {
      return res.status(403).json({ error: 'Unauthorized: Client does not belong to this workspace.' });
    }

    // CURRENCY CALCULATION
    let rate = 1;
    try {
      rate = await getExchangeRate(currency || 'USD', 'USD');
    } catch (e) {
      console.warn('[Currency Service]: Fallback to 1:1 rate');
    }
    
    const baseTotal = parseFloat(total) * rate;

    const { data, error } = await supabaseAdmin
      .from('invoices')
      .insert([{ 
        org_id: orgId, 
        client_id, 
        invoice_number, 
        total, 
        currency: currency || 'USD',
        base_currency_total: baseTotal,
        exchange_rate_at_creation: rate,
        status: status || 'Draft', 
        due_date,
        line_items: line_items || []
      }])
      .select('*, clients(*)')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('[Invoices POST Error]:', err.message);
    res.status(500).json({ error: 'Database rejected invoice creation.' });
  }
});

// 3. UPDATE INVOICE
router.put('/:id', async (req, res) => {
  const orgId = req.headers['x-org-id'] || req.body.org_id;
  if (!orgId) return res.status(400).json({ error: 'Organization context missing' });

  try {
    const { id } = req.params;
    const updates = req.body;

    const { data: invoice, error } = await supabaseAdmin
      .from('invoices')
      .update(updates)
      .eq('id', id)
      .eq('org_id', orgId) 
      .select('*, clients(*)')
      .single();

    if (error) throw error;

    if (updates.status === 'Paid') {
      triggerOnboardingWorkflow(invoice, orgId);
    }

    res.status(200).json(invoice);
  } catch (err) {
    console.error('[Invoices PUT Error]:', err.message);
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// 4. DELETE INVOICE
router.delete('/:id', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  if (!orgId) return res.status(400).json({ error: 'Organization context missing' });

  try {
    const { error } = await supabaseAdmin
      .from('invoices')
      .delete()
      .eq('id', req.params.id)
      .eq('org_id', orgId);

    if (error) throw error;
    res.status(204).send(); 
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

// AUTOMATION ENGINE
async function triggerOnboardingWorkflow(invoice, orgId) {
  const WEBHOOK_URL = process.env.N8N_ONBOARDING_WEBHOOK;
  if (!WEBHOOK_URL) return;

  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'invoice.paid',
        org_id: orgId,
        client_name: invoice.clients?.name || invoice.clients?.company,
        client_email: invoice.clients?.email,
        amount: invoice.total,
        currency: invoice.currency,
        invoice_id: invoice.id
      })
    });
  } catch (err) {
    console.error('[n8n Trigger Failed]:', err.message);
  }
}

module.exports = router;