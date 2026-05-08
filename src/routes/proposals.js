const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');

// Failsafe import: handle both default exports and destructured object exports
const authModule = require('../middleware/auth');
const requireAuth = typeof authModule === 'function' ? authModule : authModule.requireAuth;

router.use(requireAuth);

// GET PROPOSALS
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('proposals')
      .select('*, projects(*, clients(*))')
      .eq('freelancer_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json(data || []);
  } catch (err) {
    console.error('[Proposals GET Error]:', err.message);
    res.status(500).json({ error: 'Failed to fetch proposals' });
  }
});

// CREATE PROPOSAL
router.post('/', async (req, res) => {
  try {
    // FIXED: Now actively extracting title and description from React
    const { project_id, title, description, price, timeline } = req.body;
    
    const { data: projectData, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('client_id')
      .eq('id', project_id)
      .eq('freelancer_id', req.user.id)
      .single();
      
    if (projectError || !projectData) {
      return res.status(403).json({ error: 'Invalid project' });
    }

    const { data, error } = await supabaseAdmin
      .from('proposals')
      .insert([{ 
        freelancer_id: req.user.id, 
        client_id: projectData.client_id,
        project_id, 
        title,             // FIXED: Passing to Supabase
        description,       // FIXED: Passing to Supabase
        price, 
        timeline,
        status: 'Draft'
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('[Proposals POST Error]:', err.message);
    res.status(500).json({ error: 'Failed to create proposal' });
  }
});

// NEW: DELETE PROPOSAL (For the 3-dots menu)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('proposals')
      .delete()
      .eq('id', id)
      .eq('freelancer_id', req.user.id); // Security Lock: Ensures they can't delete other people's data

    if (error) throw error;
    res.status(200).json({ message: 'Proposal deleted successfully' });
  } catch (err) {
    console.error('[Proposals DELETE Error]:', err.message);
    res.status(500).json({ error: 'Failed to delete proposal' });
  }
});

// UPDATE PROPOSAL
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { project_id, title, description, price, timeline } = req.body;

    const { data, error } = await supabaseAdmin
      .from('proposals')
      .update({ project_id, title, description, price, timeline })
      .eq('id', id)
      .eq('freelancer_id', req.user.id) // Security lock
      .select()
      .single();

    if (error) throw error;
    res.status(200).json(data);
  } catch (err) {
    console.error('[Proposals PUT Error]:', err.message);
    res.status(500).json({ error: 'Failed to update proposal' });
  }
});

module.exports = router;