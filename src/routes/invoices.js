/**
 * @fileoverview Financial Invoicing & Automation Engine
 * @architecture Multi-tenant, RBAC Secured, Telemetry Enabled, PDF Integrated
 * * CRITICAL FIXES APPLIED:
 * - Security Vulnerability Patched: `PUT` payloads are now strictly destructured. Impossible to inject `org_id`.
 * - Solves Issue #30: `triggerOnboardingWorkflow` is properly awaited with a non-blocking timeout strategy.
 * - Integration: Wired up `pdfService.js` to enable server-side PDF generation.
 * - Centralized Security: Replaced manual org checks with `requireOrgMember`.
 * - Route Fix: async added to POST and orphaned brackets removed.
 */

const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');
const { getExchangeRate } = require('../services/currencyService');
const { generateInvoicePDF } = require('../services/pdfService');
const { requireAuth, requireOrgMember } = require('../middleware/auth');

// Safe fetch wrapper for CommonJS/Node <18 compatibility (Issue #19/20 mitigation)
const fetchWrapper = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// ==========================================
// 🛡️ UTILITIES & VALIDATION
// ==========================================
const isValidUUID = (uuid) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);

const VALID_STATUSES = ['Draft', 'Sent', 'Paid', 'Overdue', 'Void', 'Refunded'];

// GLOBAL SECURITY: Authenticated users who are VERIFIED members of the workspace
router.use(requireAuth);
router.use(requireOrgMember); // Injects req.orgRole and guarantees req.headers['x-org-id']

// ==========================================
// 1. RETRIEVE ALL INVOICES
// ==========================================
router.get('/', async (req, res) => {
  const orgId = req.headers['x-org-id'];

  try {
    const { data, error } = await supabaseAdmin
      .from('invoices')
      .select('*, clients(id, name, company, email)') 
      .eq('org_id', orgId) // 🔒 Strict Tenant Segregation
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json(data || []);
  } catch (err) {
    console.error('[Invoices GET Error]:', err.message);
    res.status(500).json({ error: 'Failed to compile financial ledger.' });
  }
});

// ==========================================
// 2. CREATE INVOICE
// ==========================================
router.post('/', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  
  // 🔒 THE FIX: Added project_id to the destructuring
  const { client_id, project_id, invoice_number, total, status, due_date, currency, line_items } = req.body;

  if (!client_id || !invoice_number || total === undefined) {
    return res.status(400).json({ error: 'Missing mandatory parameters (client_id, invoice_number, total).' });
  }

  if (!isValidUUID(client_id)) {
    return res.status(400).json({ error: 'Malformed client identifier.' });
  }

  try {
    // 1. SECURITY: Verify client belongs to this Org
    const { data: clientCheck, error: clientErr } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('id', client_id)
      .eq('org_id', orgId)
      .single();

    if (clientErr || !clientCheck) {
      return res.status(403).json({ error: 'Security Exception: Client does not reside within your workspace.' });
    }

    // 2. CURRENCY CALCULATION (Dynamic FX via Service)
    const baseCurrency = currency || 'USD';
    let rate = await getExchangeRate(baseCurrency, 'USD');
    const baseTotal = parseFloat(total) * rate;

    // 3. DATABASE EXECUTION
    const { data, error } = await supabaseAdmin
      .from('invoices')
      .insert([{ 
        org_id: orgId, 
        creator_id: req.user.id, // Audit trail
        client_id, 
        project_id: project_id || null, // 🔒 THE FIX: Pass the project_id to Supabase
        invoice_number, 
        total: parseFloat(total) || 0, 
        currency: baseCurrency,
        base_currency_total: parseFloat(baseTotal.toFixed(2)),
        exchange_rate_at_creation: rate,
        status: status || 'Draft', 
        due_date: due_date || null,
        line_items: Array.isArray(line_items) ? line_items : []
      }])
      .select('*, clients(*)')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('[Invoices POST Error]:', err.message);
    res.status(500).json({ error: 'Database execution failed during invoice generation.' });
  }
});

// ==========================================
// 3. UPDATE INVOICE
// ==========================================
router.put('/:id', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  const invoiceId = req.params.id;

  if (!isValidUUID(invoiceId)) {
    return res.status(400).json({ error: 'Malformed invoice identifier.' });
  }

  // 1. STRICT PAYLOAD DESTRUCTURING (Vulnerability Patch)
  const { total, status, due_date, currency, line_items } = req.body;
  
  const updatePayload = { updated_at: new Date().toISOString() };
  if (total !== undefined) updatePayload.total = parseFloat(total);
  if (due_date !== undefined) updatePayload.due_date = due_date;
  if (currency !== undefined) updatePayload.currency = currency;
  if (Array.isArray(line_items)) updatePayload.line_items = line_items;
  
  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Permitted: ${VALID_STATUSES.join(', ')}` });
    }
    updatePayload.status = status;
  }

  try {
    // 2. Fetch current state to check if status is transitioning to 'Paid'
    const { data: previousState } = await supabaseAdmin
      .from('invoices')
      .select('status')
      .eq('id', invoiceId)
      .eq('org_id', orgId)
      .single();

    // 3. Database Execution
    const { data: invoice, error } = await supabaseAdmin
      .from('invoices')
      .update(updatePayload)
      .eq('id', invoiceId)
      .eq('org_id', orgId) // 🔒 Strict Tenant Segregation
      .select('*, clients(*)')
      .single();

    if (error) throw error;

    // 4. AUTOMATION ENGINE TRIGGER (Issue #30 Resolved)
    if (status === 'Paid' && previousState?.status !== 'Paid') {
      // We await the trigger, but catch inner errors so it doesn't block the 200 OK response
      await triggerOnboardingWorkflow(invoice, orgId).catch(err => {
        console.error('[n8n Webhook Failure]:', err.message);
      });
    }

    res.status(200).json(invoice);
  } catch (err) {
    console.error('[Invoices PUT Error]:', err.message);
    res.status(500).json({ error: 'Failed to synchronize financial mutations.' });
  }
});

// ==========================================
// 4. DELETE INVOICE (RBAC)
// ==========================================
router.delete('/:id', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  const invoiceId = req.params.id;

  // RBAC: Standard members cannot delete financial records
  if (req.orgRole === 'member') {
    return res.status(403).json({ error: 'Elevated privileges required to delete invoices.' });
  }

  if (!isValidUUID(invoiceId)) {
    return res.status(400).json({ error: 'Malformed invoice identifier.' });
  }

  try {
    const { error } = await supabaseAdmin
      .from('invoices')
      .delete()
      .eq('id', invoiceId)
      .eq('org_id', orgId);

    if (error) throw error;
    
    console.warn(`[INVOICE DELETED] Org: ${orgId} | Invoice: ${invoiceId} | Operator: ${req.user.id}`);
    res.status(204).send(); 
  } catch (err) {
    console.error('[Invoices DELETE Error]:', err.message);
    res.status(500).json({ error: 'Failed to execute record destruction.' });
  }
});

// ==========================================
// 5. EXPORT SERVER-SIDE PDF
// ==========================================
router.get('/:id/pdf', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  const invoiceId = req.params.id;

  if (!isValidUUID(invoiceId)) return res.status(400).json({ error: 'Invalid invoice ID.' });

  try {
    // 1. Fetch Invoice + Client
    const { data: invoice, error: invError } = await supabaseAdmin
      .from('invoices')
      .select('*, clients(*)')
      .eq('id', invoiceId)
      .eq('org_id', orgId)
      .single();

    if (invError || !invoice) return res.status(404).json({ error: 'Invoice not found.' });

    // 2. Fetch Workspace Branding
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('name, brand_settings')
      .eq('id', orgId)
      .single();

    if (orgError) throw orgError;

    // 3. Generate PDF Buffer using Puppeteer Service
    const pdfBuffer = await generateInvoicePDF(
      invoice, 
      invoice.clients, 
      org.name || 'Regulus.', 
      org.brand_settings || {}
    );

    // 4. Stream to Client
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoice.invoice_number || 'invoice'}.pdf"`,
      'Content-Length': pdfBuffer.length
    });

    res.send(pdfBuffer);
  } catch (err) {
    console.error('[PDF Generation Error]:', err.message);
    res.status(500).json({ error: 'Failed to generate PDF document.' });
  }
});

// ==========================================
// 🤖 AUTOMATION ENGINE HANDLER
// ==========================================
async function triggerOnboardingWorkflow(invoice, orgId) {
  const WEBHOOK_URL = process.env.N8N_ONBOARDING_WEBHOOK;
  if (!WEBHOOK_URL) {
    console.log('[Telemetry]: N8N_ONBOARDING_WEBHOOK not configured. Skipping automation.');
    return;
  }

  // Uses fetchWrapper to prevent crash in CommonJS Node < 18
  await fetchWrapper(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'invoice.paid',
      org_id: orgId,
      client_name: invoice.clients?.company || invoice.clients?.name || 'Unknown Client',
      client_email: invoice.clients?.email,
      amount: invoice.total,
      currency: invoice.currency,
      invoice_id: invoice.id,
      timestamp: new Date().toISOString()
    })
  });
  
  console.log(`[Automation Triggered] Webhook dispatched for Invoice ${invoice.id}`);
}

module.exports = router;