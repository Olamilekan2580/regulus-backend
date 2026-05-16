const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const supabaseAdmin = require('../config/supabase');

// Apply the bouncer
router.use(requireAuth);

// GET: Fetch all clients for the specific Organization
router.get('/', async (req, res, next) => {
  // DEFENSIVE FIX: Check headers first, fallback to query parameters
  const orgId = req.headers['x-org-id'] || req.query.org_id;

  if (!orgId) return res.status(400).json({ error: 'Organization context missing. Refresh your dashboard.' });

  try {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('org_id', orgId) 
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
});

// POST: Create a new client within the Organization
router.post('/', async (req, res, next) => {
  try {
    const { name, email, phone, company, org_id } = req.body;
    
    // DEFENSIVE FIX: Check body first (standard for POST forms), fallback to headers
    const targetOrgId = org_id || req.headers['x-org-id'];

    if (!targetOrgId) return res.status(400).json({ error: 'Organization context missing. Cannot attach client to a void workspace.' });
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are strictly required.' });
    }

    const { data, error } = await supabaseAdmin
      .from('clients')
      .insert([{ 
        org_id: targetOrgId, 
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
    // Expected user error (Conflict)
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A client with this email already exists in this workspace.' });
    }
    
    next(err); 
  }
});

module.exports = router;