const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');
const crypto = require('crypto');

/**
 * @fileoverview Enterprise Webhook & Lifecycle Dispatcher
 * @architecture Atomic State Promotion / Event-Driven
 * This handles the critical transition from "Money Received" to "Work Started".
 */

// --- LIFECYCLE HELPERS ---

/**
 * Promotes a project to 'Active' status and ensures the client has access.
 */
async function igniteProject(projectId) {
  const intakeToken = crypto.randomBytes(32).toString('hex');
  
  const { error } = await supabaseAdmin
    .from('projects')
    .update({
      status: 'Active',
      activated_at: new Date().toISOString(),
      intake_token: intakeToken, // Secure link for the client to submit requirements
      updated_at: new Date().toISOString()
    })
    .eq('id', projectId);

  if (error) {
    console.error(`[LIFECYCLE ERROR] Failed to ignite project ${projectId}:`, error.message);
    throw error;
  }
  
  return intakeToken;
}

/**
 * Handler: Client -> Freelancer Payment
 */
async function handleInvoicePayment(payload, invoiceId) {
  // 1. Fetch Invoice + Project metadata
  const { data: invoice, error: fetchErr } = await supabaseAdmin
    .from('invoices')
    .select('status, project_id, org_id, total, currency')
    .eq('id', invoiceId)
    .single();

  if (fetchErr || !invoice) throw new Error('INVOICE_NOT_FOUND');
  
  // Idempotency check: Don't process twice if FLW sends multiple webhooks
  if (invoice.status === 'Paid') {
    console.log(`[IDEMPOTENCY] Invoice ${invoiceId} already handled.`);
    return;
  }

  // 2. Mark Invoice as Paid
  const { error: invUpdateErr } = await supabaseAdmin
    .from('invoices')
    .update({ 
      status: 'Paid',
      payment_meta: payload,
      updated_at: new Date().toISOString() 
    })
    .eq('id', invoiceId);

  if (invUpdateErr) throw invUpdateErr;

  // 3. Project Promotion (The Ignition)
  if (invoice.project_id) {
    await igniteProject(invoice.project_id);
    console.log(`[LIFECYCLE] Project ${invoice.project_id} promoted to ACTIVE.`);
  }

  // 4. TODO: Dispatch Post-Payment Notification (n8n / Email)
  console.log(`[RECONCILIATION] Transaction verified for Org: ${invoice.org_id}`);
}

/**
 * Handler: Freelancer -> Platform Subscription
 */
async function handleSaaSUpgrade(payload, orgId, planTier) {
  const { error } = await supabaseAdmin
    .from('organizations')
    .update({ 
      subscription_status: 'active',
      plan_tier: planTier,
      last_billing_date: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', orgId);

  if (error) throw error;
  console.log(`[BILLING] Org ${orgId} upgraded to ${planTier.toUpperCase()}.`);
}

// --- MAIN DISPATCHER ---

router.post('/flutterwave', async (req, res) => {
  const secretHash = process.env.FLW_WEBHOOK_HASH;
  const signature = req.headers['verif-hash'];

  // 1. Security Handshake
  if (!signature || signature !== secretHash) {
    console.warn('[SECURITY] Blocked unauthorized webhook attempt from:', req.ip);
    return res.status(401).end();
  }

  const payload = req.body;

  // 2. Acknowledge Receipt (Avoid FLW timeouts)
  res.status(200).end();

  try {
    // 3. Status Filter
    if (payload.status !== 'successful') return;

    const txRef = payload.tx_ref;

    // 4. Event Dispatching
    if (txRef.startsWith('regulus-inv-')) {
      const invoiceId = txRef.split('-')[2];
      await handleInvoicePayment(payload, invoiceId);
    } 
    else if (txRef.startsWith('regulus-sub-')) {
      const parts = txRef.split('-');
      const orgId = parts[2];
      const planTier = parts[3];
      await handleSaaSUpgrade(payload, orgId, planTier);
    }

  } catch (err) {
    console.error('[WEBHOOK CRITICAL FAILURE]:', err.message);
    // In production, log to Sentry/Datadog here
  }
});

module.exports = router;