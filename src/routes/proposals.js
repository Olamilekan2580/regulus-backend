const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const authModule = require('../middleware/auth');
const requireAuth = typeof authModule === 'function' ? authModule : authModule.requireAuth;

router.use(requireAuth);

// 1. GET PROPOSALS
router.get('/', async (req, res) => {
  // Check header first, fallback to a query param if needed
  const orgId = req.headers['x-org-id'] || req.query.org_id;
  
  if (!orgId) return res.status(400).json({ error: 'Organization context missing' });

  try {
    const { data, error } = await supabaseAdmin
      .from('proposals')
      .select('*, projects(*, clients(*))')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json(data || []);
  } catch (err) {
    console.error('[Proposals GET Error]:', err.message);
    res.status(500).json({ error: 'Failed to fetch proposals' });
  }
});

// 2. CREATE PROPOSAL
router.post('/', async (req, res) => {
  // ROBUST CHECK: Look in headers, then look in the request body
  const orgId = req.headers['x-org-id'] || req.body.org_id;
  
  if (!orgId) {
    return res.status(400).json({ error: 'Organization ID is required for multi-tenant isolation.' });
  }

  try {
    const { project_id, title, description, price, timeline } = req.body;
    
    // VERIFICATION: Does this project actually belong to the Org?
    // Note: If 'Cloud Computinhg' has NULL for org_id in the DB, this check WILL fail.
    const { data: projectData, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('client_id, name')
      .eq('id', project_id)
      .eq('org_id', orgId) // Strict isolation
      .single();
      
    if (projectError || !projectData) {
      console.error(`[Auth Block]: Project ${project_id} not linked to Org ${orgId}`);
      return res.status(403).json({ error: 'Project not found or not linked to your workspace.' });
    }

    const { data, error } = await supabaseAdmin
      .from('proposals')
      .insert([{ 
        org_id: orgId, 
        client_id: projectData.client_id,
        project_id, 
        title,            
        description,      
        price, 
        timeline,
        status: 'Draft'
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('[Proposals POST Error]:', err.message);
    res.status(500).json({ error: 'Database rejected proposal creation.' });
  }
});

// 3. UPDATE PROPOSAL
router.put('/:id', async (req, res) => {
  const orgId = req.headers['x-org-id'] || req.body.org_id;
  if (!orgId) return res.status(400).json({ error: 'Organization context missing' });

  try {
    const { id } = req.params;
    const { project_id, title, description, price, timeline, status } = req.body;

    const { data, error } = await supabaseAdmin
      .from('proposals')
      .update({ project_id, title, description, price, timeline, status })
      .eq('id', id)
      .eq('org_id', orgId) // Ensure user can't update someone else's proposal
      .select()
      .single();

    if (error) throw error;
    res.status(200).json(data);
  } catch (err) {
    console.error('[Proposals PUT Error]:', err.message);
    res.status(500).json({ error: 'Failed to update proposal' });
  }
});

// 4. DELETE PROPOSAL
router.delete('/:id', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  if (!orgId) return res.status(400).json({ error: 'Organization context missing' });

  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin
      .from('proposals')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);

    if (error) throw error;
    res.status(200).json({ message: 'Proposal deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete proposal' });
  }
});

// 5. STRIPE CHECKOUT
router.post('/:id/checkout', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: proposal, error } = await supabaseAdmin
      .from('proposals')
      .select('*, clients(name, email)')
      .eq('id', id)
      .single();

    if (error || !proposal) {
      return res.status(404).json({ error: 'Proposal not found' });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Stripe is not configured on this server.' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: proposal.clients?.email,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Proposal: ${proposal.title}`,
            description: proposal.description || 'Project deposit.',
          },
          unit_amount: Math.round(parseFloat(proposal.price) * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/proposals/${id}/success`,
      cancel_url: `${process.env.FRONTEND_URL}/proposals/${id}`,
      metadata: {
        proposal_id: proposal.id,
        org_id: proposal.org_id,
        type: 'proposal_funding'
      }
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[Stripe Checkout Error]:', err.message);
    res.status(500).json({ error: 'Failed to initialize payment gateway' });
  }
});

module.exports = router;