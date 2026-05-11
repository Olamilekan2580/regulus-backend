const supabaseAdmin = require('../config/supabase');

const requireAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid token' });

    req.user = user;

    // Fetch user settings to check onboarding and subscription status
    const { data: settings } = await supabaseAdmin
      .from('freelancer_settings')
      .select('onboarding_completed, subscription_status, trial_ends_at')
      .eq('freelancer_id', user.id)
      .single();

    // Attach to request for downstream use
    req.settings = settings || { onboarding_completed: false, subscription_status: 'trialing', trial_ends_at: new Date(Date.now() + 12096e5) };

    // SUBSCRIPTION ENFORCEMENT ENGINE
    // If trial is expired and they haven't paid, lock them out of everything EXCEPT settings/billing
    const now = new Date();
    const trialEnds = new Date(req.settings.trial_ends_at);
    
    if (now > trialEnds && req.settings.subscription_status !== 'active') {
      const isExemptRoute = req.originalUrl.includes('/settings') || req.originalUrl.includes('/billing');
      if (!isExemptRoute) {
        return res.status(402).json({ error: 'Subscription expired. Payment required.', code: 'PAYMENT_REQUIRED' });
      }
    }

    next();
  } catch (err) {
    res.status(401).json({ error: 'Authentication failed' });
  }
};

const requireOrgMember = async (req, res, next) => {
  const orgId = req.headers['x-org-id']; // Frontend must send this header
  if (!orgId) return res.status(400).json({ error: 'Organization context missing' });

  const { data: membership, error } = await supabaseAdmin
    .from('org_memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', req.user.id)
    .single();

  if (error || !membership) {
    return res.status(403).json({ error: 'Not a member of this organization' });
  }

  req.orgRole = membership.role; // Useful for RBAC (Role Based Access Control)
  next();
};

// 🔒 THE FIX: Export both middlewares so routes do not crash on import
module.exports = { requireAuth, requireOrgMember };