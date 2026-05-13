/**
 * @fileoverview Proposals Management & Financial Gateway
 * @architecture Multi-tenant, Lazy-Loaded Stripe Gateway, RBAC Secured
 * * CRITICAL FIXES APPLIED:
 * - Solves Issue #8: Stripe is now lazy-loaded inside the checkout route. Missing env vars won't crash the server on boot.
 * - Centralized Security: Replaced manual `org_id` checks with the bulletproof `requireOrgMember` middleware.
 * - Checkout Vulnerability Patched: The Stripe session generation now strictly enforces `org_id` ownership.
 * - RBAC Enforcement: Standard members cannot delete financial documents.
 * - Attachment Pipeline: Added multer and Supabase storage upload logic for PDF/Doc attachments.
 * - Enterprise Documents: Added support for 7-section proposal structures.
 */

const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');
const { requireAuth, requireOrgMember } = require('../middleware/auth');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() }); // Keep file in memory temporarily

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
// FETCH SINGLE PROPOSAL (BY ID)
// ==========================================
router.get('/:id', async (req, res) => {
  const proposalId = req.params.id;

  try {
    const { data, error } = await supabaseAdmin
      .from('proposals')
      .select('*, clients(*)')
      .eq('id', proposalId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Proposal not found or deleted.' });
    }

    res.status(200).json(data);
  } catch (err) {
    console.error('[Single Proposal GET Error]:', err.message);
    res.status(500).json({ error: 'Failed to retrieve proposal document.' });
  }
});

// ==========================================
// 2. CREATE PROPOSAL
// ==========================================
router.post('/', upload.single('attachment'), async (req, res) => {
  const orgId = req.headers['x-org-id'];
  
  // 🔒 Catch all document sections from the FormData
  const { 
    client_id, project_id, title, description, price, status,
    executive_summary, objectives, proposed_solution, timeline, deliverables, assumptions 
  } = req.body;

  if (!client_id || !title || price === undefined) {
    return res.status(400).json({ error: 'Missing mandatory proposal parameters.' });
  }

  if (!isValidUUID(client_id)) {
    return res.status(400).json({ error: 'Malformed client identifier.' });
  }

  try {
    let attachmentUrl = null;

    // 1. If a file was attached, upload it to Supabase Storage FIRST
    if (req.file) {
      const fileName = `${Date.now()}_${req.file.originalname.replace(/\s+/g, '_')}`;
      
      const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
        .from('attachments')
        .upload(`proposals/${fileName}`, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false
        });

      if (uploadError) throw new Error(`Storage Upload Failed: ${uploadError.message}`);

      // Get the public URL of the uploaded file
      const { data: publicUrlData } = supabaseAdmin.storage
        .from('attachments')
        .getPublicUrl(uploadData.path);
        
      attachmentUrl = publicUrlData.publicUrl;
    }

    // 2. Execute the database insert with all new sections
    const { data, error } = await supabaseAdmin
      .from('proposals')
      .insert([{ 
        org_id: orgId, 
        client_id,
        project_id: project_id || null, 
        title: title.trim(),            
        description: description ? description.trim() : null,      
        executive_summary: executive_summary ? executive_summary.trim() : null,
        objectives: objectives ? objectives.trim() : null,
        proposed_solution: proposed_solution ? proposed_solution.trim() : null,
        timeline: timeline ? timeline.trim() : null,
        deliverables: deliverables ? deliverables.trim() : null,
        assumptions: assumptions ? assumptions.trim() : null,
        price: parseFloat(price) || 0, 
        status: status || 'Draft',
        attachment_url: attachmentUrl 
      }])
      .select('*, clients(*)')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('[Proposals POST Error]:', err.message);
    res.status(500).json({ error: err.message || 'Database execution failed during proposal generation.' });
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

  // Ensure update payload catches the new sections
  const { 
    project_id, title, description, price, status,
    executive_summary, objectives, proposed_solution, timeline, deliverables, assumptions 
  } = req.body;

  try {
    const { data, error } = await supabaseAdmin
      .from('proposals')
      .update({ 
        project_id, 
        title, 
        description, 
        executive_summary,
        objectives,
        proposed_solution,
        timeline,
        deliverables,
        assumptions,
        price: price !== undefined ? parseFloat(price) : undefined, 
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