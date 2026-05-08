const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');

router.get('/portal/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;

    // 1. Get the client to find out WHO the freelancer is
    const { data: client, error: clientErr } = await supabaseAdmin.from('clients').select('*').eq('id', clientId).single();
    if (clientErr || !client) return res.status(404).json({ error: 'Portal not found' });

    // 2. Fetch everything else concurrently using the freelancer_id
    const [projectRes, invoiceRes, settingsRes, proposalRes] = await Promise.all([
      supabaseAdmin.from('projects').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
      supabaseAdmin.from('invoices').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
      supabaseAdmin.from('freelancer_settings').select('paystack_public_key, brand_name, brand_color').eq('freelancer_id', client.freelancer_id).single(),
      // NEW: Fetching the proposals specifically for this client
      supabaseAdmin.from('proposals').select('*, projects(name)').eq('client_id', clientId).order('created_at', { ascending: false })
    ]);

    res.status(200).json({
      client,
      projects: projectRes.data || [],
      invoices: invoiceRes.data || [],
      proposals: proposalRes.data || [], // <-- THIS makes the document appear on the portal
      settings: settingsRes.data || { brand_name: 'Regulus', brand_color: '#1E293B', paystack_public_key: null }
    });
  } catch (err) {
    console.error('[Public Portal Error]:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==========================================
// NEW: HANDLE PROPOSAL APPROVAL/REJECTION
// ==========================================
router.put('/proposals/:proposalId/status', async (req, res) => {
  try {
    const { proposalId } = req.params;
    const { status } = req.body; 

    // Security check to prevent malicious status injection
    if (!['Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status update' });
    }

    // Update the database (Uses Admin key because the client isn't logged in)
    const { data, error } = await supabaseAdmin
      .from('proposals')
      .update({ status })
      .eq('id', proposalId)
      .select()
      .single();

    if (error) throw error;

    res.status(200).json(data);
  } catch (err) {
    console.error('[Public Proposal PUT Error]:', err.message);
    res.status(500).json({ error: 'Failed to update proposal status' });
  }
});

module.exports = router;