const express = require('express');
const router = express.Router();
const axios = require('axios');
const supabaseAdmin = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

/**
 * @fileoverview SaaS Billing & Subscription Engine
 * @architecture Zero-Trust, Flutterwave-Integrated
 * This controller handles the conversion of freelancers into paying subscribers.
 */

// 1. CONFIGURATION
const PLAN_PRICES = {
  solo: {
    usd: 29,
    ngn: 45000 // Fixed exchange rate for regional price stability
  },
  agency: {
    usd: 99,
    ngn: 155000
  }
};

/**
 * POST /api/billing/subscribe
 * Initiates a Flutterwave Checkout session for a SaaS plan.
 */
router.post('/subscribe', requireAuth, async (req, res) => {
  try {
    const { plan_tier, currency = 'USD' } = req.body;
    const selectedCurrency = currency.toUpperCase();

    // A. Validation: Ensure the plan exists
    if (!PLAN_PRICES[plan_tier]) {
      return res.status(400).json({ error: 'Invalid plan tier selected.' });
    }

    // B. Security: Look up the user's Organization ID from the DB (Zero-Trust Frontend)
    const { data: membership, error: memErr } = await supabaseAdmin
      .from('org_memberships')
      .select('org_id, role')
      .eq('user_id', req.user.id)
      .single();

    if (memErr || !membership) {
      return res.status(403).json({ error: 'You are not a member of a workspace.' });
    }

    // RBAC: Only Owners and Admins can trigger billing mutations
    if (!['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ error: 'Insufficient permissions to modify workspace billing.' });
    }

    const orgId = membership.org_id;

    // C. Construct the Deterministic Transaction Reference
    // Format: regulus-sub-[ORG_ID]-[PLAN]-[TIMESTAMP]
    const txRef = `regulus-sub-${orgId}-${plan_tier}-${Date.now()}`;

    // D. Prepare Flutterwave Payload
    const flwPayload = {
      tx_ref: txRef,
      amount: selectedCurrency === 'NGN' ? PLAN_PRICES[plan_tier].ngn : PLAN_PRICES[plan_tier].usd,
      currency: selectedCurrency,
      redirect_url: `${process.env.FRONTEND_URL}/settings?billing_status=verify&ref=${txRef}`,
      payment_options: "card, account, ussd",
      customer: {
        email: req.user.email,
        name: req.user.full_name || 'Regulus User',
      },
      meta: {
        org_id: orgId,
        plan_tier: plan_tier,
        user_id: req.user.id
      },
      customizations: {
        title: "Regulus Platform",
        description: `Upgrade to ${plan_tier.toUpperCase()} Subscription`,
        logo: "https://your-regulus-logo.com/icon.png",
      }
    };

    // E. Execute Flutterwave Handshake
    const response = await axios.post(
      'https://api.flutterwave.com/v3/payments',
      flwPayload,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.status !== 'success') {
      throw new Error('Flutterwave failed to generate payment link.');
    }

    // F. Return Secure Link to Frontend
    res.status(200).json({ 
      success: true, 
      url: response.data.data.link,
      tx_ref: txRef 
    });

  } catch (err) {
    console.error('[BILLING ERROR]:', err.response?.data || err.message);
    res.status(500).json({ 
      error: 'The billing gateway is temporarily unreachable. Please contact support.' 
    });
  }
});

module.exports = router;