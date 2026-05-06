const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('freelancer_settings')
      .select('paystack_public_key, brand_name, brand_color, onboarding_completed, subscription_status, trial_ends_at')
      .eq('freelancer_id', req.user.id)
      .single();
    res.status(200).json(data || {});
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

router.put('/', async (req, res) => {
  try {
    const { paystack_public_key, paystack_secret_key, brand_name, brand_color, onboarding_completed } = req.body;
    
    const updatePayload = { freelancer_id: req.user.id, updated_at: new Date() };
    if (paystack_public_key !== undefined) updatePayload.paystack_public_key = paystack_public_key;
    if (paystack_secret_key !== undefined) updatePayload.paystack_secret_key = paystack_secret_key;
    if (brand_name !== undefined) updatePayload.brand_name = brand_name;
    if (brand_color !== undefined) updatePayload.brand_color = brand_color;
    if (onboarding_completed !== undefined) updatePayload.onboarding_completed = onboarding_completed;

    const { error } = await supabaseAdmin
      .from('freelancer_settings')
      .upsert(updatePayload, { onConflict: 'freelancer_id' });

    if (error) throw error;
    res.status(200).json({ message: 'Settings saved' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

module.exports = router;
