const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');
const requireAuth = require('../middleware/auth');

const authModule = require('../middleware/auth');
const authMiddleware = typeof authModule === 'function' ? authModule : authModule.requireAuth;

router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;

    const [clients, projects, invoices] = await Promise.all([
      supabaseAdmin.from('clients').select('id', { count: 'exact' }).eq('freelancer_id', userId),
      supabaseAdmin.from('projects').select('id', { count: 'exact' }).eq('freelancer_id', userId),
      supabaseAdmin.from('invoices').select('total, status').eq('freelancer_id', userId)
    ]);

    const totalRevenue = invoices.data
      .filter(inv => inv.status === 'Paid')
      .reduce((sum, inv) => sum + parseFloat(inv.total), 0);

    const outstanding = invoices.data
      .filter(inv => inv.status !== 'Paid')
      .reduce((sum, inv) => sum + parseFloat(inv.total), 0);

    res.status(200).json({
      clientCount: clients.count || 0,
      projectCount: projects.count || 0,
      revenue: totalRevenue.toFixed(2),
      outstanding: outstanding.toFixed(2)
    });
  } catch (err) {
    console.error('[Stats Error]:', err.message);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

module.exports = router;
