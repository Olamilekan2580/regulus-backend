const express = require('express');
const router = express.Router();
let stripe;

if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
} else {
  console.warn('⚠️ CRITICAL: STRIPE_SECRET_KEY is missing. Payments disabled.');
  stripe = require('stripe')('sk_test_dummy'); 
}

const supabaseAdmin = require('../config/supabase');
const authModule = require('../middleware/auth');
const requireAuth = typeof authModule === 'function' ? authModule : authModule.requireAuth;

// PRICE ID MAPPING
const PRICE_IDS = {
  solo: 'price_1TVaPuP9XEZoEW0xMvy21Ep6',
  agency: 'price_1TVaQGP9XEZoEW0xnMpAp2iC'
};

// 1. GENERATE DYNAMIC SUBSCRIPTION CHECKOUT
router.post('/subscribe', requireAuth, async (req, res) => {
  try {
    const { plan_tier } = req.body;

    if (!PRICE_IDS[plan_tier]) {
      return res.status(400).json({ error: 'Invalid plan tier selected.' });
    }

    // 🔒 THE ARCHITECTURAL FIX: Ignore the frontend payload. Securely look up the org_id using the authenticated user's ID.
    const { data: membership, error: memErr } = await supabaseAdmin
      .from('org_memberships')
      .select('org_id')
      .eq('user_id', req.user.id)
      .single();

    if (memErr || !membership || !membership.org_id) {
      return res.status(404).json({ error: 'Organization membership not found for this user.' });
    }

    const orgId = membership.org_id;

    // Verify the organization actually exists
    const { data: org, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('id', orgId)
      .single();
      
    if (orgErr || !org) {
      return res.status(404).json({ error: 'Organization not found in database.' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{
        price: PRICE_IDS[plan_tier], 
        quantity: 1,
      }],
      client_reference_id: orgId, // Attach the securely fetched org_id
      metadata: { plan_tier },
      success_url: `${req.headers.origin}/settings?billing=success`,
      cancel_url: `${req.headers.origin}/settings?billing=canceled`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[Stripe Session Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. STRIPE WEBHOOK (Handles the "Real" DB Updates)
router.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle successful payment
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orgId = session.client_reference_id;
    const planTier = session.metadata.plan_tier;

    if (orgId) {
      await supabaseAdmin.from('organizations').update({
        subscription_status: 'active',
        plan_tier: planTier, 
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription
      }).eq('id', orgId);
    }
  }

  // Handle cancellations
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    await supabaseAdmin.from('organizations').update({
      subscription_status: 'canceled'
    }).eq('stripe_subscription_id', subscription.id);
  }

  res.status(200).json({ received: true });
});

module.exports = router;