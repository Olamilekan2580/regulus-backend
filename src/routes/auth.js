const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');

// 1. SIGNUP ROUTE
router.post('/signup', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    
    // Tell Supabase to create the user and trigger the verification email
    const { data, error } = await supabaseAdmin.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName }
      }
    });

    if (error) throw error;
    
    res.status(201).json({ message: 'User created. Check email for verification.', user: data.user });
  } catch (err) {
    console.error('[Signup Error]:', err.message);
    res.status(400).json({ error: err.message || 'Failed to create account' });
  }
});

// 2. LOGIN ROUTE
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Verify credentials with Supabase
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    // Send the JWT back to the frontend so it can be stored in localStorage
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
