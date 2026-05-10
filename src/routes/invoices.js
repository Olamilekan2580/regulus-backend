const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');
const { getExchangeRate } = require('../services/currencyService');

const authModule = require('../middleware/auth');
const requireAuth = typeof authModule === 'function' ? authModule : authModule.requireAuth;

router.use(requireAuth);

// 1. GET ALL INVOICES (Multi-tenant)
router.get('/', async (req, res) => {
  const orgId = req.headers['x-org-id'];
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

// 2. CREATE INVOICE (Now supports dynamic line_items)
router.post('/', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  if (!orgId) return res.status(400).json({ error: 'Organization context missing' });

  try {
    // Destructure line_items from the incoming request
    const { client_id, invoice_number, total, status, due_date, currency, line_items } = req.body;
    
    const rate = await getExchangeRate(currency || 'USD', 'USD');
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
        status, 
        due_date,
        line_items: line_items || [] // Save the dynamic array
      }])
      .select('*, clients(*)')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('[Invoices POST Error]:', err.message);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// 3. UPDATE INVOICE (Merged block with n8n webhook trigger)
router.put('/:id', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  if (!orgId) return res.status(400).json({ error: 'Organization context missing' });

  try {
    const { id } = req.params;
    const updates = req.body;

    const { data: invoice, error } = await supabaseAdmin
      .from('invoices')
      .update(updates)
      .eq('id', id)
      .eq('org_id', orgId) // Security: Prevent updating cross-workspace invoices
      .select('*, clients(*)')
      .single();

    if (error) throw error;

    // Trigger n8n Automation only when status changes to 'Paid'
    if (updates.status === 'Paid') {
      triggerOnboardingWorkflow(invoice);
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
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('invoices')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);

    if (error) throw error;
    
    res.status(204).send(); 
  } catch (err) {
    console.error('[Invoices DELETE Error]:', err.message);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

// Webhook Automation Logic
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
        project_id: invoice.project_id
      })
    });
  } catch (err) {
    console.error('Automation Trigger Failed:', err.message);
  }
}

module.exports = router;