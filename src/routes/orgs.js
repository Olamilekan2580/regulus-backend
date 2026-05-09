const crypto = require('crypto');
const router = require('express').Router();
const supabaseAdmin = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

// CRITICAL FIX: Guard all routes below this line to ensure req.user exists
router.use(requireAuth);

// GET USER'S ACTIVE ORGANIZATION (Used on Login to set Context)
router.get('/me', async (req, res) => {
  try {
    const { data: membership, error: memErr } = await supabaseAdmin
      .from('org_memberships')
      .select('org_id, role')
      .eq('user_id', req.user.id)
      .single();

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

// GET SPECIFIC ORGANIZATION (Used by Layout and Settings for Branding)
router.get('/:orgId', async (req, res) => {
  try {
    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('id', req.params.orgId)
      .single();

    if (error) throw error;
    res.status(200).json(org);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch organization details.' });
  }
});

// UPDATE PAYMENT GATEWAY SETTINGS
router.put('/:orgId/payments', async (req, res) => {
  const { provider, stripe_pk, stripe_sk, paystack_pk, paystack_sk } = req.body;
  const { orgId } = req.params;

  try {
    // Security Check: Only Admins/Owners
    const { data: membership } = await supabaseAdmin
      .from('org_memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', req.user.id)
      .single();

    if (!membership || membership.role === 'member') {
      return res.status(403).json({ error: 'Only Admins can configure payments.' });
    }

    // Update the payment_settings JSONB column
    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .update({ 
        payment_settings: { 
          provider, 
          stripe_pk, 
          stripe_sk, 
          paystack_pk, 
          paystack_sk 
        } 
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

// --- NEW: GET ALL MEMBERS FOR A WORKSPACE ---
router.get('/:orgId/members', async (req, res) => {
  try {
    // 1. Verify requester has access to this org
    const { data: requesterMem, error: reqErr } = await supabaseAdmin
      .from('org_memberships')
      .select('role')
      .eq('org_id', req.params.orgId)
      .eq('user_id', req.user.id)
      .single();

    if (reqErr || !requesterMem) return res.status(403).json({ error: 'Access denied.' });

    // 2. Fetch all memberships for the org
    const { data: memberships, error: memErr } = await supabaseAdmin
      .from('org_memberships')
      .select('user_id, role, created_at')
      .eq('org_id', req.params.orgId);

    if (memErr) throw memErr;

    // 3. To get emails, we need to query Auth Admin (in a real app, you might have a public profiles table)
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
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch team members.' });
  }
});

// --- NEW: REMOVE A TEAM MEMBER ---
router.delete('/:orgId/members/:userId', async (req, res) => {
  try {
    // 1. Check requester role (Must be Admin or Owner)
    const { data: requester } = await supabaseAdmin
      .from('org_memberships')
      .select('role')
      .eq('org_id', req.params.orgId)
      .eq('user_id', req.user.id)
      .single();

    if (!requester || requester.role === 'member') {
      return res.status(403).json({ error: 'Access denied. Only Admins can remove members.' });
    }

    // 2. Prevent deleting the Owner
    const { data: target } = await supabaseAdmin
      .from('org_memberships')
      .select('role')
      .eq('org_id', req.params.orgId)
      .eq('user_id', req.params.userId)
      .single();

    if (target?.role === 'owner') {
      return res.status(400).json({ error: 'Cannot remove the workspace owner.' });
    }

    // 3. Execute Deletion
    await supabaseAdmin
      .from('org_memberships')
      .delete()
      .eq('org_id', req.params.orgId)
      .eq('user_id', req.params.userId);

    res.status(200).json({ message: 'Member removed successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove member.' });
  }
});

// CREATE ORGANIZATION
router.post('/', async (req, res) => {
  const { name, subdomain } = req.body;
  try {
    // 1. Create Org
    const { data: org, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .insert([{ owner_id: req.user.id, name, subdomain }])
      .select().single();

    if (orgErr) throw orgErr;

    // 2. Automatically make creator the 'owner' in memberships
    await supabaseAdmin
      .from('org_memberships')
      .insert([{ org_id: org.id, user_id: req.user.id, role: 'owner' }]);

    res.status(201).json(org);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE BRANDING
router.put('/:orgId/branding', async (req, res) => {
  const { navy, accent } = req.body;
  const { orgId } = req.params;

  try {
    // 1. Security: Only the Org Owner or Admin should change branding
    const { data: membership } = await supabaseAdmin
      .from('org_memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', req.user.id)
      .single();

    if (!membership || membership.role === 'member') {
      return res.status(403).json({ error: 'Only Admins can change branding.' });
    }

    // 2. Update the JSONB column
    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .update({ 
        brand_settings: { primary: navy, accent: accent } 
      })
      .eq('id', orgId)
      .select('brand_settings')
      .single();

    if (error) throw error;

    res.status(200).json(org.brand_settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update brand settings.' });
  }
});

// SEND INVITE
router.post('/:orgId/invite', async (req, res) => {
  const { email, role } = req.body;
  const token = crypto.randomBytes(32).toString('hex');

  try {
    // SECURITY: Ensure inviter has permission
    const { data: requester } = await supabaseAdmin
      .from('org_memberships')
      .select('role')
      .eq('org_id', req.params.orgId)
      .eq('user_id', req.user.id)
      .single();

    if (!requester || requester.role === 'member') {
      return res.status(403).json({ error: 'Only Admins can invite new members.' });
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

// ACCEPT INVITE
router.post('/accept-invite', async (req, res) => {
  const { token } = req.body;

  try {
    // 1. Validate the token exists and hasn't expired
    const { data: invite, error: inviteErr } = await supabaseAdmin
      .from('org_invitations')
      .select('*')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (inviteErr || !invite) {
      return res.status(400).json({ error: 'Invalid or expired invite link. Request a new one.' });
    }

    // 2. Bind the current user to the Organization
    const { error: membershipErr } = await supabaseAdmin
      .from('org_memberships')
      .insert([{ 
        org_id: invite.org_id, 
        user_id: req.user.id, 
        role: invite.role 
      }]);

    if (membershipErr) {
      // If it's a unique constraint error, they are already in the org
      if (membershipErr.code === '23505') {
         return res.status(400).json({ error: 'You are already a member of this workspace.' });
      }
      throw membershipErr;
    }

    // 3. Burn the token (Delete it so it can't be reused)
    await supabaseAdmin
      .from('org_invitations')
      .delete()
      .eq('id', invite.id);

    // 4. Get the Org name to send back to the frontend
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name')
      .eq('id', invite.org_id)
      .single();

    res.status(200).json({ 
      message: 'Successfully joined the organization', 
      org_id: invite.org_id,
      org_name: org.name
    });

  } catch (err) {
    console.error('[Accept Invite Error]:', err.message);
    res.status(500).json({ error: 'Failed to process the invitation' });
  }
});

module.exports = router;