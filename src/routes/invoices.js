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

// 2. CREATE NEW INVOICE
router.post('/', async (req, res) => {
  try {
    const { client_id, invoice_number, total, status, due_date } = req.body;

    // Basic Architecture Validation
    if (!client_id || total === undefined) {
      return res.status(400).json({ error: 'Client ID and Total Amount are required.' });
    }

    const { data, error } = await supabaseAdmin
      .from('invoices')
      .insert([{ freelancer_id: req.user.id, client_id, invoice_number, total, status, due_date }])
      .select('*, clients(*)') // Return the joined data instantly for the frontend UI
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('[Invoices POST Error]:', err.message);
    res.status(500).json({ error: 'Failed to create invoice' });
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

module.exports = router;