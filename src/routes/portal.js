const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');

// GET: Fetch client portal data using the unique token (NO requireAuth here)
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // 1. Authenticate via token and get the Client + Freelancer details
    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('id, name, company, users(name, business_name)')
      .eq('portal_token', token)
      .single();

    if (clientError || !client) {
      return res.status(404).json({ error: 'Invalid or expired portal link' });
    }

    // 2. Fetch all related data for this client
    const [projectsRes, invoicesRes, proposalsRes] = await Promise.all([
      supabaseAdmin.from('projects').select('*').eq('client_id', client.id).order('created_at', { ascending: false }),
      supabaseAdmin.from('invoices').select('*').eq('client_id', client.id).order('created_at', { ascending: false }),
      supabaseAdmin.from('proposals').select('*').eq('client_id', client.id).order('created_at', { ascending: false })
    ]);

    // 3. Package and send the secure payload
    res.status(200).json({
      freelancer: client.users,
      client: { name: client.name, company: client.company },
      projects: projectsRes.data || [],
      invoices: invoicesRes.data || [],
      proposals: proposalsRes.data || []
    });

  } catch (err) {
    console.error('[Portal GET Error]:', err.message);
    res.status(500).json({ error: 'Failed to load client portal' });
  }
});

module.exports = router;