const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');

// 1. SIGNUP ROUTE (Now with Workspace Binding)
router.post('/signup', async (req, res) => {
  try {
    // We added inviteToken to the expected payload
    const { email, password, fullName, inviteToken } = req.body; 
    let invitation = null;

    // STEP A: If an invite token was provided, validate it BEFORE creating the user
    if (inviteToken) {
      const { data: inviteData, error: inviteErr } = await supabaseAdmin
        .from('org_invitations')
        .select('*')
        .eq('token', inviteToken)
        .single();

      if (inviteErr || !inviteData) {
        return res.status(400).json({ error: 'Invalid or expired invitation token.' });
      }

      // Security check: Ensure the email matches the invitation
      if (inviteData.email.toLowerCase() !== email.toLowerCase()) {
        return res.status(400).json({ error: 'This email does not match the invitation.' });
      }

      invitation = inviteData;
    }

    // STEP B: Create the user in Supabase Auth
    const { data, error } = await supabaseAdmin.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName }
      }
    });

    if (error) throw error;
    const userId = data.user.id;

    // STEP C: The Magic Link - Bind the user to the workspace
    if (invitation) {
      // 1. Create their membership in the agency
      const { error: membershipErr } = await supabaseAdmin
        .from('org_memberships')
        .insert([{
          org_id: invitation.org_id,
          user_id: userId,
          role: invitation.role
        }]);

      if (membershipErr) throw membershipErr;

      // 2. Burn the invitation token so it cannot be used again
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

// 2. LOGIN ROUTE (Remains unchanged)
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

module.exports = router;