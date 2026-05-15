const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');

// ==========================================
// 1. SIGNUP ROUTE (Email & Invitations)
// ==========================================
router.post('/signup', async (req, res) => {
  try {
    const { email, password, fullName, inviteToken } = req.body; 
    let invitation = null;

    if (inviteToken) {
      const { data: inviteData, error: inviteErr } = await supabaseAdmin
        .from('org_invitations')
        .select('*')
        .eq('token', inviteToken)
        .single();

      if (inviteErr || !inviteData) {
        return res.status(400).json({ error: 'Invalid or expired invitation token.' });
      }

      if (inviteData.email.toLowerCase() !== email.toLowerCase()) {
        return res.status(400).json({ error: 'This email does not match the invitation.' });
      }

      invitation = inviteData;
    }

    const { data, error } = await supabaseAdmin.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName }
      }
    });

    if (error) throw error;
    const userId = data.user.id;

    if (invitation) {
      const { error: membershipErr } = await supabaseAdmin
        .from('org_memberships')
        .insert([{
          org_id: invitation.org_id,
          user_id: userId,
          role: invitation.role
        }]);

      if (membershipErr) throw membershipErr;

      await supabaseAdmin
        .from('org_invitations')
        .delete()
        .eq('id', invitation.id);
    }

    res.status(201).json({ message: 'User created successfully.', user: data.user });
  } catch (err) {
    console.error('[Signup Error]:', err.message);
    res.status(400).json({ error: err.message || 'Failed to create account' });
  }
});

// ==========================================
// 2. LOGIN ROUTE (Email & Password)
// ==========================================
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    res.status(200).json({ 
      token: data.session.access_token, 
      user: data.user 
    });
  } catch (err) {
    console.error('[Login Error]:', err.message);
    res.status(401).json({ error: err.message || 'Invalid email or password' });
  }
});

// ==========================================
// 3. OAUTH AUTO-PROVISIONING (Google & GitHub)
// ==========================================
router.post('/init-workspace', async (req, res) => {
  const { email, name, auth_id } = req.body;

  if (!email || !auth_id) {
    return res.status(400).json({ error: 'Missing required auth payload.' });
  }

  try {
    // A. Check if they already have an org_id in their profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('org_id')
      .eq('id', auth_id)
      .single();

    if (profile && profile.org_id) {
      return res.status(200).json({ org_id: profile.org_id });
    }

    // B. Create the new Workspace / Organization
    const { data: newOrg, error: orgError } = await supabaseAdmin
      .from('organizations')
      .insert([{ name: `${name || email.split('@')[0]}'s Workspace` }])
      .select()
      .single();

    if (orgError) throw orgError;

    // C. Upsert the Profile to the new org_id 
    // (Creates the row if missing, updates it if it exists)
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({ 
        id: auth_id, 
        email: email, 
        full_name: name || email.split('@')[0], 
        org_id: newOrg.id 
      });

    if (profileError) throw profileError;

    // D. Create the membership record (Matching your signup route schema)
    const { error: membershipError } = await supabaseAdmin
      .from('org_memberships')
      .insert([{ 
        org_id: newOrg.id, 
        user_id: auth_id, 
        role: 'owner' 
      }]);

    if (membershipError) throw membershipError;

    console.log(`[Provisioning]: Built workspace for OAuth user ${email}`);
    res.status(200).json({ org_id: newOrg.id });

  } catch (err) {
    console.error('[Workspace Init Error]:', err.message);
    res.status(500).json({ error: 'Failed to provision workspace database.' });
  }
});

module.exports = router;