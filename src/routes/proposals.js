const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Stripe Initialization

const authModule = require('../middleware/auth');
const requireAuth = typeof authModule === 'function' ? authModule : authModule.requireAuth;

// Note: If clients view proposals via a public link without logging in, 
// we will need to bypass requireAuth for specific routes later. 
// For now, we assume the agency is managing this.
router.use(requireAuth);

// 1. GET PROPOSALS (Multi-tenant)
router.get('/', async (req, res) => {
  const orgId = req.headers['x-org-id'];
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
  const orgId = req.headers['x-org-id'];
  if (!orgId) return res.status(400).json({ error: 'Organization context missing' });

  try {
    const { project_id, title, description, price, timeline } = req.body;
    
    // Verify the project belongs to this org
    const { data: projectData, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('client_id')
      .eq('id', project_id)
      .eq('org_id', orgId)
      .single();
      
    if (projectError || !projectData) {
      return res.status(403).json({ error: 'Invalid project or unauthorized' });
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
    res.status(500).json({ error: 'Failed to create proposal' });
  }
});

// 3. UPDATE PROPOSAL
router.put('/:id', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  if (!orgId) return res.status(400).json({ error: 'Organization context missing' });

  try {
    const { id } = req.params;
    const { project_id, title, description, price, timeline, status } = req.body;

    const { data, error } = await supabaseAdmin
      .from('proposals')
      .update({ project_id, title, description, price, timeline, status })
      .eq('id', id)
      .eq('org_id', orgId)
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
    console.error('[Proposals DELETE Error]:', err.message);
    res.status(500).json({ error: 'Failed to delete proposal' });
  }
});

// ==========================================
// 5. THE FINANCIAL ENGINE: STRIPE CHECKOUT
// ==========================================
router.post('/:id/checkout', async (req, res) => {
  // If a client is accepting this via a public link, we might not have x-org-id in headers.
  // We fetch the proposal first to verify it exists and get its details.
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

    // Generate the Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: proposal.clients?.email, // Pre-fill client email
      line_items: [
        {
          price_data: {
            currency: 'usd', // Expand to dynamic currency later if needed
            product_data: {
              name: `Proposal: ${proposal.title}`,
              description: proposal.description || 'Project deposit/escrow funding.',
            },
            unit_amount: Math.round(parseFloat(proposal.price) * 100), // Stripe calculates in cents ($1,000 = 100000)
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      // We will create a success page on your frontend shortly
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/proposals/${id}/success`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/proposals/${id}`,
      metadata: {
        proposal_id: proposal.id,
        org_id: proposal.org_id,
        type: 'proposal_funding'
      }
    });

    // Send the secure Stripe URL back to the frontend
    res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('[Stripe Checkout Error]:', err.message);
    res.status(500).json({ error: 'Failed to initialize payment gateway' });
  }
});

module.exports = router;