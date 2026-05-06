const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');

const authModule = require('../middleware/auth');
const requireAuth = typeof authModule === 'function' ? authModule : authModule.requireAuth;

router.use(requireAuth);

router.put('/:entity/:id', async (req, res) => {
  try {
    const { entity, id } = req.params;
    const { status } = req.body;
    
    // Security: Only allow specific tables to be mutated via this route
    const allowedTables = ['projects', 'invoices', 'proposals'];
    if (!allowedTables.includes(entity)) {
      return res.status(403).json({ error: 'Invalid entity type' });
    }

    const { data, error } = await supabaseAdmin
      .from(entity)
      .update({ status })
      .eq('id', id)
      .eq('freelancer_id', req.user.id) // Ensure they own the record
      .select()
      .single();

    if (error) throw error;
    res.status(200).json(data);
  } catch (err) {
    console.error(`[Update Error - ${req.params.entity}]:`, err.message);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

module.exports = router;
