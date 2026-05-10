const crypto = require('crypto');
const router = require('express').Router();
const supabaseAdmin = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

// GLOBAL SECURITY: All routes require an authenticated user session
router.use(requireAuth);

// ==========================================
// 1. WORKSPACE CONTEXT (The App's Heart)
// ==========================================
router.get('/me', async (req, res) => {
  try {
    const { data: membership, error: memErr } = await supabaseAdmin
      .from('org_memberships')
      .select('org_id, role')
      .eq('user_id', req.user.id)
      .maybeSingle(); // Better than .single() to avoid 406 errors on empty states

    if (memErr || !membership) {
      return res.status(404).json({ error: 'No workspace found.' });
    }

    const { data: org, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('id', membership.org_id)
      .single();

    if (orgErr) throw orgErr;

    res.status(200).json({ ...org, role: membership.role });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch workspace context.' });
  }
});

// ==========================================
// 2. CREATION & ONBOARDING (The Entry Point)
// POST /api/orgs - CREATE a new workspace and link it
router.post('/', async (req, res) => {
  const { name, subdomain } = req.body;
  if (!name) return res.status(400).json({ error: 'Workspace name is required.' });

  try {
    // 1. Create Organization
    const { data: org, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .insert([{ 
        owner_id: req.user.id, 
        name, 
        subdomain: subdomain || null,
        // CHANGE THIS LINE FROM false TO true
        onboarding_completed: true, 
        brand_settings: { primary: '#141929', accent: '#08F7BB' }
      }])
      .select().single();

    if (orgErr) throw orgErr;

    // 2. Create Owner Membership
    await supabaseAdmin
      .from('org_memberships')
      .insert([{ org_id: org.id, user_id: req.user.id, role: 'owner' }]);

    res.status(201).json(org);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:orgId/complete-onboarding', async (req, res) => {
  try {
    // Only the owner should be able to finalize the workspace setup
    const { data: membership } = await supabaseAdmin
      .from('org_memberships')
      .select('role')
      .eq('org_id', req.params.orgId)
      .eq('user_id', req.user.id)
      .single();

    if (membership?.role !== 'owner') {
      return res.status(403).json({ error: 'Only the owner can finalize onboarding.' });
    }

    const { error } = await supabaseAdmin
      .from('organizations')
      .update({ onboarding_completed: true })
      .eq('id', req.params.orgId);

    if (error) throw error;
    res.status(200).json({ message: 'Onboarding finalized.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to finalize onboarding.' });
  }
});

// ==========================================
// 3. SETTINGS & BRANDING (RBAC Protected)
// ==========================================
router.put('/:orgId/branding', async (req, res) => {
  const { navy, accent } = req.body;
  const { orgId } = req.params;

  try {
    const { data: membership } = await supabaseAdmin
      .from('org_memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', req.user.id)
      .single();

    if (!membership || membership.role === 'member') {
      return res.status(403).json({ error: 'Access denied. Admin rights required.' });
    }

    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .update({ brand_settings: { primary: navy, accent: accent } })
      .eq('id', orgId)
      .select('brand_settings')
      .single();

    if (error) throw error;
    res.status(200).json(org.brand_settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update brand settings.' });
  }
});

router.put('/:orgId/payments', async (req, res) => {
  const { provider, stripe_pk, stripe_sk, paystack_pk, paystack_sk } = req.body;
  const { orgId } = req.params;

  try {
    const { data: membership } = await supabaseAdmin
      .from('org_memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', req.user.id)
      .single();

    if (!membership || membership.role === 'member') {
      return res.status(403).json({ error: 'Access denied. Admin rights required.' });
    }

    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .update({ 
        payment_settings: { provider, stripe_pk, stripe_sk, paystack_pk, paystack_sk } 
      })
      .eq('id', orgId)
      .select('payment_settings')
      .single();

    if (error) throw error;
    res.status(200).json(org.payment_settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update payment settings.' });
  }
});

// ==========================================
// 4. TEAM MANAGEMENT (The "Social" Muscle)
// ==========================================
router.get('/:orgId/members', async (req, res) => {
  try {
    const { data: requester } = await supabaseAdmin
      .from('org_memberships')
      .select('role')
      .eq('org_id', req.params.orgId)
      .eq('user_id', req.user.id)
      .single();

    if (!requester) return res.status(403).json({ error: 'Access denied.' });

    const { data: memberships, error: memErr } = await supabaseAdmin
      .from('org_memberships')
      .select('user_id, role, created_at')
      .eq('org_id', req.params.orgId);

    if (memErr) throw memErr;

    // Cross-reference with Auth to get emails
    const { data: { users }, error: authErr } = await supabaseAdmin.auth.admin.listUsers();
    if (authErr) throw authErr;

    const formattedMembers = memberships.map(m => {
      const user = users.find(u => u.id === m.user_id);
      return { 
        user_id: m.user_id, 
        role: m.role, 
        joined: m.created_at, 
        email: user ? user.email : 'Unknown User' 
      };
    });

    res.status(200).json(formattedMembers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch team members.' });
  }
});

router.delete('/:orgId/members/:userId', async (req, res) => {
  try {
    const { data: requester } = await supabaseAdmin
      .from('org_memberships')
      .select('role')
      .eq('org_id', req.params.orgId)
      .eq('user_id', req.user.id)
      .single();

    if (!requester || requester.role === 'member') {
      return res.status(403).json({ error: 'Admin rights required.' });
    }

    const { data: target } = await supabaseAdmin
      .from('org_memberships')
      .select('role')
      .eq('org_id', req.params.orgId)
      .eq('user_id', req.params.userId)
      .single();

    if (target?.role === 'owner') return res.status(400).json({ error: 'Owner cannot be removed.' });

    await supabaseAdmin
      .from('org_memberships')
      .delete()
      .eq('org_id', req.params.orgId)
      .eq('user_id', req.params.userId);

    res.status(200).json({ message: 'Member removed.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove member.' });
  }
});

// ==========================================
// 5. INVITATIONS (Tokenized Security)
// ==========================================
router.post('/:orgId/invite', async (req, res) => {
  const { email, role } = req.body;
  const token = crypto.randomBytes(32).toString('hex');

  try {
    const { data: requester } = await supabaseAdmin
      .from('org_memberships')
      .select('role')
      .eq('org_id', req.params.orgId)
      .eq('user_id', req.user.id)
      .single();

    if (!requester || requester.role === 'member') {
      return res.status(403).json({ error: 'Admin rights required to invite.' });
    }

    const { error } = await supabaseAdmin
      .from('org_invitations')
      .insert([{ 
        org_id: req.params.orgId, 
        inviter_id: req.user.id, 
        email, 
        role, 
        token 
      }]);

    if (error) throw error;
    res.status(200).json({ message: 'Invite created', token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/accept-invite', async (req, res) => {
  const { token } = req.body;
  try {
    const { data: invite, error: inviteErr } = await supabaseAdmin
      .from('org_invitations')
      .select('*')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (inviteErr || !invite) return res.status(400).json({ error: 'Invalid link.' });

    await supabaseAdmin
      .from('org_memberships')
      .insert([{ org_id: invite.org_id, user_id: req.user.id, role: invite.role }]);

    await supabaseAdmin.from('org_invitations').delete().eq('id', invite.id);

    res.status(200).json({ message: 'Joined successfully', org_id: invite.org_id });
  } catch (err) {
    res.status(500).json({ error: 'Invite failed.' });
  }
});

// ==========================================
// UPGRADE WORKSPACE PLAN (DEV MODE)
// ==========================================
router.put('/:id/plan', async (req, res) => {
  const orgId = req.params.id;
  const { plan_tier, subscription_status } = req.body;

  try {
    const { error } = await supabaseAdmin
      .from('organizations')
      .update({ 
        plan_tier: plan_tier, 
        subscription_status: subscription_status 
      })
      .eq('id', orgId);

    if (error) throw error;
    res.status(200).json({ message: 'Plan upgraded successfully.' });
  } catch (err) {
    console.error('[Plan Upgrade Error]:', err.message);
    res.status(500).json({ error: 'Failed to upgrade workspace plan.' });
  }
});

module.exports = router;