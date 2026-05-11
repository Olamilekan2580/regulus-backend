/**
 * @fileoverview Proposals Management & Financial Gateway
 * @architecture Multi-tenant, Lazy-Loaded Stripe Gateway, RBAC Secured
 * * CRITICAL FIXES APPLIED:
 * - Solves Issue #8: Stripe is now lazy-loaded inside the checkout route. Missing env vars won't crash the server on boot.
 * - Centralized Security: Replaced manual `org_id` checks with the bulletproof `requireOrgMember` middleware.
 * - Checkout Vulnerability Patched: The Stripe session generation now strictly enforces `org_id` ownership.
 * - RBAC Enforcement: Standard members cannot delete financial documents.
 */

const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');
const { requireAuth, requireOrgMember } = require('../middleware/auth');

// ==========================================
// 🛡️ UTILITIES
// ==========================================

const isValidUUID = (uuid) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

// GLOBAL SECURITY: Authenticated users who are VERIFIED members of the workspace
router.use(requireAuth);
router.use(requireOrgMember); // Guarantees req.headers['x-org-id'] is valid and injects req.orgRole

// ==========================================
// 1. RETRIEVE ALL PROPOSALS
// ==========================================
router.get('/', async (req, res) => {
  const orgId = req.headers['x-org-id'];

  try {
    const { data, error } = await supabaseAdmin
      .from('proposals')
      .select('*, projects(*, clients(*))')
      .eq('org_id', orgId) // 🔒 Strict Tenant Segregation
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json(data || []);
  } catch (err) {
    console.error('[Proposals GET Error]:', err.message);
    res.status(500).json({ error: 'Failed to compile proposal directory.' });
  }
});

// ==========================================
// 2. CREATE PROPOSAL
// ==========================================
router.post('/', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  const { project_id, title, description, price, timeline } = req.body;

  if (!project_id || !title || price === undefined) {
    return res.status(400).json({ error: 'Missing mandatory proposal parameters (project_id, title, price).' });
  }

  if (!isValidUUID(project_id)) {
    return res.status(400).json({ error: 'Malformed project identifier.' });
  }

  try {
    // SECURITY: Verify the target project actually belongs to the requesting workspace
    const { data: projectData, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('client_id, name')
      .eq('id', project_id)
      .eq('org_id', orgId) // 🔒 Prevents cross-tenant linking
      .single();
      
    if (projectError || !projectData) {
      console.warn(`[SECURITY WARN] User ${req.user.id} attempted to link proposal to unowned project ${project_id}`);
      return res.status(403).json({ error: 'Security Exception: Target project is not linked to your workspace.' });
    }

    // Database Execution
    const { data, error } = await supabaseAdmin
      .from('proposals')
      .insert([{ 
        org_id: orgId, 
        client_id: projectData.client_id,
        project_id, 
        title: title.trim(),            
        description: description ? description.trim() : null,      
        price: parseFloat(price) || 0, 
        timeline: timeline ? timeline.trim() : null,
        status: 'Draft'
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('[Proposals POST Error]:', err.message);
    res.status(500).json({ error: 'Database execution failed during proposal generation.' });
  }
});

// ==========================================
// 3. UPDATE PROPOSAL
// ==========================================
router.put('/:id', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  const proposalId = req.params.id;

  if (!isValidUUID(proposalId)) {
    return res.status(400).json({ error: 'Malformed proposal identifier.' });
  }

  const { project_id, title, description, price, timeline, status } = req.body;

  try {
    const { data, error } = await supabaseAdmin
      .from('proposals')
      .update({ 
        project_id, 
        title, 
        description, 
        price: price !== undefined ? parseFloat(price) : undefined, 
        timeline, 
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', proposalId)
      .eq('org_id', orgId) // 🔒 Strict Tenant Segregation
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Proposal not found or access denied.' });
      throw error;
    }

    res.status(200).json(data);
  } catch (err) {
    console.error('[Proposals PUT Error]:', err.message);
    res.status(500).json({ error: 'Failed to synchronize proposal mutations.' });
  }
});

// ==========================================
// 4. DELETE PROPOSAL (RBAC SECURED)
// ==========================================
router.delete('/:id', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  const proposalId = req.params.id;

  // Role-Based Access Control: Members cannot delete financial documents
  if (req.orgRole === 'member') {
    return res.status(403).json({ error: 'Elevated privileges required to permanently delete proposals.' });
  }

  if (!isValidUUID(proposalId)) {
    return res.status(400).json({ error: 'Malformed proposal identifier.' });
  }

  try {
    const { error } = await supabaseAdmin
      .from('proposals')
      .delete()
      .eq('id', proposalId)
      .eq('org_id', orgId);

    if (error) throw error;
    
    console.log(`[PROPOSAL DELETED] Org: ${orgId} | Proposal: ${proposalId} | Operator: ${req.user.id}`);
    res.status(200).json({ message: 'Proposal record permanently destroyed.' });
  } catch (err) {
    console.error('[Proposals DELETE Error]:', err.message);
    res.status(500).json({ error: 'Failed to execute record destruction.' });
  }
});

// ==========================================
// 5. INTERNAL STRIPE CHECKOUT (LAZY-LOADED)
// ==========================================
router.post('/:id/checkout', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  const proposalId = req.params.id;

  if (!isValidUUID(proposalId)) {
    return res.status(400).json({ error: 'Malformed proposal identifier.' });
  }

  try {
    // 1. Verify proposal ownership before generating a financial link
    const { data: proposal, error } = await supabaseAdmin
      .from('proposals')
      .select('*, clients(name, email)')
      .eq('id', proposalId)
      .eq('org_id', orgId) // 🔒 CRITICAL FIX: Cross-tenant vulnerability patched
      .single();

    if (error || !proposal) {
      return res.status(404).json({ error: 'Proposal not found within your workspace context.' });
    }

    // 2. LAZY LOAD STRIPE: Prevents server crash on boot if env var is missing
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Financial gateway is not configured on this server. Missing STRIPE_SECRET_KEY.' });
    }
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    // 3. Generate Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: proposal.clients?.email || undefined,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Proposal Deposit: ${proposal.title}`,
            description: proposal.description ? proposal.description.substring(0, 250) : 'Project engagement deposit.',
          },
          unit_amount: Math.round(parseFloat(proposal.price) * 100), // Stripe expects cents
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/proposals/${proposalId}?success=true`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/proposals/${proposalId}?canceled=true`,
      metadata: {
        proposal_id: proposal.id,
        org_id: proposal.org_id,
        type: 'proposal_funding'
      }
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[Stripe Checkout Error]:', err.message);
    res.status(500).json({ error: 'Failed to initialize payment gateway.' });
  }
});

module.exports = router;