const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabaseAdmin = require('../config/supabase');

// ---------------------------------------------------------
// 1. TENANT WEBHOOK: How your freelancers get paid by clients
// ---------------------------------------------------------
router.post('/paystack', async (req, res) => {
  try {
    const event = req.body;
    const freelancerId = event.data?.metadata?.freelancer_id;
    if (!freelancerId) return res.status(400).send('Missing freelancer context');

    const { data: settings } = await supabaseAdmin.from('freelancer_settings').select('paystack_secret_key').eq('freelancer_id', freelancerId).single();
    if (!settings || !settings.paystack_secret_key) return res.status(400).send('Gateway not configured');

    const hash = crypto.createHmac('sha512', settings.paystack_secret_key).update(JSON.stringify(req.body)).digest('hex');
    if (hash !== req.headers['x-paystack-signature']) return res.status(401).send('Invalid signature');

    if (event.event === 'charge.success') {
      const invoiceId = event.data.metadata.invoice_id;
      await supabaseAdmin.from('invoices').update({ status: 'Paid' }).eq('id', invoiceId);
    }
    res.status(200).send('Tenant webhook processed');
  } catch (err) {
    res.status(500).send('Internal error');
  }
});

// ---------------------------------------------------------
// 2. PLATFORM WEBHOOK: How YOU get paid by freelancers
// ---------------------------------------------------------
router.post('/platform', async (req, res) => {
  try {
    // Verified using YOUR master secret key from the .env file
    const secret = process.env.PAYSTACK_SECRET_KEY; 
    const hash = crypto.createHmac('sha512', secret).update(JSON.stringify(req.body)).digest('hex');
    
    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(401).send('Invalid platform signature');
    }

    const event = req.body;
    if (event.event === 'charge.success' || event.event === 'subscription.create') {
      const freelancerId = event.data.metadata.freelancer_id;
      
      // Upgrade their account in the database so the middleware unlocks them
      await supabaseAdmin.from('freelancer_settings').update({ 
        subscription_status: 'active',
        trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // +30 days
      }).eq('freelancer_id', freelancerId);
      
      console.log(`[REVENUE] Platform subscription activated for: ${freelancerId}`);
    }

    res.status(200).send('Platform webhook processed');
  } catch (err) {
    console.error('[Platform Webhook Error]:', err.message);
    res.status(500).send('Internal error');
  }
});

module.exports = router;
