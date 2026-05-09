const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.PLATFORM_STRIPE_SECRET_KEY); // YOUR master Stripe key
const supabaseAdmin = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

// 1. GENERATE SUBSCRIPTION CHECKOUT
router.post('/subscribe', requireAuth, async (req, res) => {
  try {
    const { orgId } = req.body;

    // Get the organization
    const { data: org } = await supabaseAdmin.from('organizations').select('*').eq('id', orgId).single();
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    // Create a Stripe Checkout Session for your $9.99/mo plan
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{
        // You MUST create a Product in your Stripe Dashboard for $9.99/mo and paste its Price ID here
        price: process.env.STRIPE_MONTHLY_PRICE_ID, 
        quantity: 1,
      }],
      client_reference_id: orgId, // CRITICAL: Tells the webhook which org paid
      success_url: `${req.headers.origin}/settings?billing=success`,
      cancel_url: `${req.headers.origin}/settings?billing=canceled`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. STRIPE WEBHOOK (How Stripe tells your DB the user actually paid)
// Note: This route must NOT use express.json() because Stripe needs the raw body
router.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the subscription success event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orgId = session.client_reference_id;

    if (orgId) {
      await supabaseAdmin.from('organizations').update({
        subscription_status: 'active',
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription
      }).eq('id', orgId);
    }
  }

  // Handle subscription cancellations
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    await supabaseAdmin.from('organizations').update({
      subscription_status: 'canceled'
    }).eq('stripe_subscription_id', subscription.id);
  }

  res.status(200).json({ received: true });
});

module.exports = router;