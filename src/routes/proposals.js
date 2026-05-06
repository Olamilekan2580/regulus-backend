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

router.post('/', async (req, res) => {
  try {
    const { project_id, content_html, price, timeline } = req.body;
    
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
        content_html, 
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

module.exports = router;
