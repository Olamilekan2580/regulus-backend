const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const supabaseAdmin = require('../config/supabase');

// Apply the bouncer
router.use(requireAuth);

// GET: Fetch all clients for the logged-in freelancer
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('freelancer_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json(data);
  } catch (err) {
    console.error('[Clients GET Error]:', err.message);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

// POST: Create a new client
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, company } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const { data, error } = await supabaseAdmin
      .from('clients')
      .insert([{ 
        freelancer_id: req.user.id, 
        name, 
        email, 
        phone, 
        company 
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('[Clients POST Error]:', err.message);
    // 23505 is the PostgreSQL error code for unique violation
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A client with this email already exists' });
    }
    res.status(500).json({ error: 'Failed to create client' });
  }
});

module.exports = router;