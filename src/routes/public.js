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
    const [projectRes, invoiceRes, settingsRes] = await Promise.all([
      supabaseAdmin.from('projects').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
      supabaseAdmin.from('invoices').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
      supabaseAdmin.from('freelancer_settings').select('paystack_public_key, brand_name, brand_color').eq('freelancer_id', client.freelancer_id).single()
    ]);

    res.status(200).json({
      client,
      projects: projectRes.data || [],
      invoices: invoiceRes.data || [],
      settings: settingsRes.data || { brand_name: 'Regulus', brand_color: '#1E293B', paystack_public_key: null }
    });
  } catch (err) {
    console.error('[Public Portal Error]:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
