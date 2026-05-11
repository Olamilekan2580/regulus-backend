const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');

// GET /api/users/me - Fetch Profile
router.get('/me', async (req, res) => {
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.admin.getUserById(req.user.id);
    if (error || !user) throw error;
    
    res.json({ 
      email: user.email, 
      first_name: user.user_metadata?.first_name || '',
      last_name: user.user_metadata?.last_name || '',
      avatar_url: user.user_metadata?.avatar_url || ''
    });
  } catch (err) {
    console.error('[User GET Error]:', err.message);
    res.status(500).json({ error: 'Failed to retrieve user profile' });
  }
});

// PUT /api/users/me - Update Profile & Password
router.put('/me', async (req, res) => {
  const { first_name, last_name, new_password } = req.body;
  
  try {
    const updatePayload = {
      user_metadata: { first_name, last_name }
    };

    if (new_password) {
      updatePayload.password = new_password;
    }

    const { data: { user }, error } = await supabaseAdmin.auth.admin.updateUserById(
      req.user.id, 
      updatePayload
    );

    if (error) throw error;
    res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    console.error('[User PUT Error]:', err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;