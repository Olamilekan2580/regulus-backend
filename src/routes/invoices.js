const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');

// Failsafe import: handle both default exports and destructured object exports
const authModule = require('../middleware/auth');
const requireAuth = typeof authModule === 'function' ? authModule : authModule.requireAuth;

router.use(requireAuth);

// 1. GET ALL INVOICES
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('invoices')
      .select('*, clients(*)') // Fetches attached client data
      .eq('freelancer_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json(data || []);
  } catch (err) {
    console.error('[Invoices GET Error]:', err.message);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

const { getExchangeRate } = require('../services/currencyService');

router.post('/', async (req, res) => {
  try {
    const { client_id, invoice_number, total, status, due_date, currency } = req.body;
    
    // Fetch the rate to your base currency (e.g., USD)
    const rate = await getExchangeRate(currency || 'USD', 'USD');
    const baseTotal = parseFloat(total) * rate;

    const { data, error } = await supabaseAdmin
      .from('invoices')
      .insert([{ 
        freelancer_id: req.user.id, 
        client_id, 
        invoice_number, 
        total, 
        currency: currency || 'USD',
        base_currency_total: baseTotal,
        exchange_rate_at_creation: rate,
        status, 
        due_date 
      }])
      .select('*, clients(*)')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create invoice with FX data' });
  }
});

// 3. UPDATE INVOICE (Change Status to Paid, Sent, etc.)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const { data, error } = await supabaseAdmin
      .from('invoices')
      .update(updates)
      .eq('id', id)
      .eq('freelancer_id', req.user.id) // Security: Prevent updating other people's invoices
      .select('*, clients(*)')
      .single();

    if (error) throw error;
    res.status(200).json(data);
  } catch (err) {
    console.error('[Invoices PUT Error]:', err.message);
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// 4. DELETE INVOICE
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('invoices')
      .delete()
      .eq('id', id)
      .eq('freelancer_id', req.user.id);

    if (error) throw error;
    
    // 204 No Content is the standard success code for a deletion
    res.status(204).send(); 
  } catch (err) {
    console.error('[Invoices DELETE Error]:', err.message);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

// backend/src/routes/invoices.js
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const { data: invoice, error } = await supabaseAdmin
      .from('invoices')
      .update(updates)
      .eq('id', id)
      .eq('freelancer_id', req.user.id)
      .select('*, clients(*)')
      .single();

    if (error) throw error;

    // ARCHITECT MOVE: Trigger Automation only when status changes to 'Paid'
    if (updates.status === 'Paid') {
      triggerOnboardingWorkflow(invoice);
    }

    res.status(200).json(invoice);
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// Logic to ping n8n or an internal worker
async function triggerOnboardingWorkflow(invoice) {
  const WEBHOOK_URL = process.env.N8N_ONBOARDING_WEBHOOK;
  if (!WEBHOOK_URL) return;

  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'invoice.paid',
        client_name: invoice.clients?.name,
        client_email: invoice.clients?.email,
        amount: invoice.total,
        project_id: invoice.project_id // If applicable
      })
    });
  } catch (err) {
    console.error('Automation Trigger Failed:', err.message);
  }
}

module.exports = router;