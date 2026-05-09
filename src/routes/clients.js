const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const supabaseAdmin = require('../config/supabase');

// Apply the bouncer
router.use(requireAuth);

// GET: Fetch all clients for the specific Organization
router.get('/', async (req, res) => {
  const orgId = req.headers['x-org-id'];

  if (!orgId) return res.status(400).json({ error: 'Organization context missing.' });

  try {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('org_id', orgId) // Filter by Organization, not User ID
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json(data);
  } catch (err) {
    console.error('[Clients GET Error]:', err.message);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

// POST: Create a new client within the Organization
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, company } = req.body;
    const orgId = req.headers['x-org-id'];

    if (!orgId) return res.status(400).json({ error: 'Organization context missing.' });
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const { data, error } = await supabaseAdmin
      .from('clients')
      .insert([{ 
        org_id: orgId, // Tied to the workspace
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
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A client with this email already exists in this workspace' });
    }
    res.status(500).json({ error: 'Failed to create client' });
  }
});

module.exports = router;