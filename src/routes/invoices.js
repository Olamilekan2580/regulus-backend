const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');

// Failsafe import: handle both default exports and destructured object exports
const authModule = require('../middleware/auth');
const requireAuth = typeof authModule === 'function' ? authModule : authModule.requireAuth;

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('invoices')
      .select('*, clients(*)')
      .eq('freelancer_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json(data || []);
  } catch (err) {
    console.error('[Invoices GET Error]:', err.message);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { client_id, invoice_number, total, status, due_date } = req.body;
    const { data, error } = await supabaseAdmin
      .from('invoices')
      .insert([{ freelancer_id: req.user.id, client_id, invoice_number, total, status, due_date }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('[Invoices POST Error]:', err.message);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

module.exports = router;
