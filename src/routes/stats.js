const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');
const { requireAuth } = require('../middleware/auth'); // Cleaned up the import

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    // 1. Grab the Organization ID from the headers (Injected by your Axios Interceptor)
    const orgId = req.headers['x-org-id'];

    if (!orgId) {
      return res.status(400).json({ error: 'Organization context missing from request headers.' });
    }

    // 2. Fetch all data scoped to the ORGANIZATION, not the user
    const [clients, projects, invoices] = await Promise.all([
      supabaseAdmin.from('clients').select('id', { count: 'exact' }).eq('org_id', orgId),
      supabaseAdmin.from('projects').select('id', { count: 'exact' }).eq('org_id', orgId),
      supabaseAdmin.from('invoices').select('total, status').eq('org_id', orgId)
    ]);

    // Handle potential nulls safely
    const invoiceList = invoices.data || [];

    const totalRevenue = invoiceList
      .filter(inv => inv.status === 'Paid')
      .reduce((sum, inv) => sum + parseFloat(inv.total || 0), 0);

    const outstanding = invoiceList
      .filter(inv => inv.status !== 'Paid')
      .reduce((sum, inv) => sum + parseFloat(inv.total || 0), 0);

    // 3. Return the exact structure your Dashboard.jsx expects
    res.status(200).json({
      clientCount: clients.count || 0,
      projectCount: projects.count || 0,
      revenue: totalRevenue.toFixed(2),
      outstanding: outstanding.toFixed(2),
      chartData: [] // Ready for Phase 2 when we map actual revenue trends
    });
  } catch (err) {
    console.error('[Stats Error]:', err.message);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

module.exports = router;