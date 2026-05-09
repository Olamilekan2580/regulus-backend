const crypto = require('crypto');
const router = require('express').Router();
const supabaseAdmin = require('../config/supabase');

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

    // ARCHITECT NOTE: This is where you'd trigger your Email Service
    // Send link: https://regulus.app/join?token=${token}
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
         return res.status(400).json({ error: 'You are already a member of this organization.' });
      }
      throw membershipErr;
    }

    // 3. Burn the token (Delete it so it can't be reused)
    await supabaseAdmin
      .from('org_invitations')
      .delete()
      .eq('id', invite.id);

    res.status(200).json({ 
      message: 'Successfully joined the organization', 
      org_id: invite.org_id 
    });

  } catch (err) {
    console.error('[Accept Invite Error]:', err.message);
    res.status(500).json({ error: 'Failed to process the invitation' });
  }
});