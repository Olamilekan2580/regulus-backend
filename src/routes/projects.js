const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const supabaseAdmin = require('../config/supabase');

router.use(requireAuth);

// GET: Fetch all projects
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('projects')
      .select('*, clients(name)')
      .eq('freelancer_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json(data);
  } catch (err) {
    console.error('[Projects GET Error]:', err.message);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// POST: Create a new project
router.post('/', async (req, res) => {
  try {
    const { client_id, name, description, value, deadline } = req.body;
    
    if (!client_id || !name) {
      return res.status(400).json({ error: 'Client ID and Project Name are required' });
    }

    const { data, error } = await supabaseAdmin
      .from('projects')
      .insert([{ 
        freelancer_id: req.user.id, 
        client_id, 
        name, 
        description, 
        value: value || 0, 
        deadline 
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('[Projects POST Error]:', err.message);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

module.exports = router;