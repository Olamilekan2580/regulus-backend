const supabaseAdmin = require('../config/supabase');

const billingGuard = async (req, res, next) => {
  const orgId = req.headers['x-org-id']; 
  
  if (!orgId) return res.status(400).json({ error: 'Missing Workspace Context' });

  try {
    const { data: org, error } = await supabaseAdmin.from('organizations')
      .select('subscription_status, trial_ends_at')
      .eq('id', orgId)
      .single();

    if (error || !org) return res.status(404).json({ error: 'Workspace not found' });

    // 1. If actively subscribed, pass immediately
    if (org.subscription_status === 'active') return next();

    // 2. Enforce the 14-Day Trial limits
    const now = new Date();
    const trialEnd = new Date(org.trial_ends_at);

    if (now > trialEnd) {
      return res.status(402).json({ 
        error: 'Payment Required', 
        message: 'Trial expired. Please upgrade to continue.' 
      });
    }

    // Still trialing, let them pass
    next();
  } catch (err) {
    res.status(500).json({ error: 'Billing verification failed' });
  }
};

module.exports = { billingGuard };