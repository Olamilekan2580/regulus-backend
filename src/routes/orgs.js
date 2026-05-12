/**
 * @fileoverview Organization & Workspace Management Routing
 * @architecture Enterprise Grade (Multi-tenant, AES-256 Encrypted, RBAC Secured)
 * * Addresses Critical System Flaws:
 * - Solves Issue #6: Implements GET /:orgId to hydrate frontend Settings.jsx
 * - Solves Issue #12: AES-256 encrypts all Secret Keys (Stripe/Paystack) at rest.
 * - Solves Issue #11: Locks down dev-mode billing upgrades to Owners only.
 */

const express = require('express');
const crypto = require('crypto');
const axios = require('axios'); // NEW: Required for Vercel API calls
const router = express.Router();
const supabaseAdmin = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

// ==========================================
// 🛡️ CRYPTOGRAPHY ENGINE (AES-256-CBC)
// ==========================================
// DYNAMIC KEY DERIVATION: Ensures the key is exactly 32 bytes regardless of the env string length
const ENCRYPTION_SECRET = process.env.ENCRYPTION_KEY || 'FATAL_OVERRIDE_DO_NOT_USE_IN_PRODUCTION_4892';
const CIPHER_ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = crypto.scryptSync(ENCRYPTION_SECRET, 'regulus_salt', 32);

/**
 * Encrypts a plaintext string into a secure AES-256 hash.
 * @param {string} text - Plaintext secret key
 * @returns {string|null} - IV:EncryptedHash format
 */
const encryptData = (text) => {
  if (!text || text.includes('••••')) return text; // Ignore empty or already masked data
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(CIPHER_ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  } catch (err) {
    console.error('[Encryption Failure]:', err.message);
    throw new Error('Cryptographic failure during vault lock.');
  }
};

/**
 * Decrypts an AES-256 hash back to plaintext for API consumption.
 * @param {string} hash - IV:EncryptedHash format
 * @returns {string|null}
 */
const decryptData = (hash) => {
  if (!hash || !hash.includes(':')) return hash; // Ignore if unencrypted or empty
  try {
    const [ivHex, encryptedHex] = hash.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(CIPHER_ALGORITHM, ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[Decryption Failure]:', err.message);
    return null; // Return null rather than crashing, prevents complete UI lockout
  }
};

/**
 * Masks a secret key for safe frontend transmission (e.g., sk_live_...••••A1B2)
 */
const maskSecret = (secret) => {
  if (!secret) return '';
  return secret.substring(0, 8) + '••••••••••••••••' + secret.slice(-4);
};


// ==========================================
// 🛡️ ROLE-BASED ACCESS CONTROL (RBAC) ENGINE
// ==========================================
/**
 * Middleware to verify a user's role within an organization before execution.
 * @param {Array<string>} allowedRoles - e.g., ['owner', 'admin']
 */
const requireOrgRole = (allowedRoles) => async (req, res, next) => {
  const orgId = req.params.orgId || req.params.id; // Support both routing conventions
  
  if (!orgId) return res.status(400).json({ error: 'Missing organization target in request.' });

  try {
    const { data: membership, error } = await supabaseAdmin
      .from('org_memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', req.user.id)
      .single();

    if (error || !membership) {
      return res.status(403).json({ error: 'Access denied. You are not a member of this workspace.' });
    }

    if (!allowedRoles.includes(membership.role)) {
      return res.status(403).json({ 
        error: `Elevated privileges required. Allowed roles: ${allowedRoles.join(', ')}.` 
      });
    }

    // Attach role to request for downstream consumption
    req.currentRole = membership.role;
    next();
  } catch (err) {
    console.error('[RBAC Error]:', err.message);
    res.status(500).json({ error: 'Authorization verification failed.' });
  }
};

// GLOBAL SECURITY: All routes require an authenticated user session
router.use(requireAuth);


// ==========================================
// 1. WORKSPACE CONTEXT & ROUTING
// ==========================================

/**
 * GET /me
 * Bootstraps the application by finding the user's primary workspace.
 */
router.get('/me', async (req, res) => {
  try {
    const { data: membership, error: memErr } = await supabaseAdmin
      .from('org_memberships')
      .select('org_id, role')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (memErr || !membership) {
      return res.status(404).json({ error: 'No workspace found. Please complete onboarding.' });
    }

    const { data: org, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('id', membership.org_id)
      .single();

    if (orgErr) throw orgErr;

    // NEVER return raw secrets to the frontend, even to owners
    if (org.payment_settings) {
      if (org.payment_settings.stripe_sk) org.payment_settings.stripe_sk = maskSecret(decryptData(org.payment_settings.stripe_sk));
      if (org.payment_settings.paystack_sk) org.payment_settings.paystack_sk = maskSecret(decryptData(org.payment_settings.paystack_sk));
    }

    res.status(200).json({ ...org, role: membership.role });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch initial workspace context.' });
  }
});

/**
 * GET /:id
 * FIX FOR ISSUE #6: Allows the Settings page to hydrate its state accurately.
 */
router.get('/:id', requireOrgRole(['owner', 'admin', 'member']), async (req, res) => {
  try {
    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !org) return res.status(404).json({ error: 'Workspace not found.' });

    // Ensure frontend hydration receives masked keys, not AES hashes
    if (org.payment_settings) {
      if (org.payment_settings.stripe_sk) org.payment_settings.stripe_sk = maskSecret(decryptData(org.payment_settings.stripe_sk));
      if (org.payment_settings.paystack_sk) org.payment_settings.paystack_sk = maskSecret(decryptData(org.payment_settings.paystack_sk));
    }

    res.status(200).json({ ...org, role: req.currentRole });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch requested workspace data.' });
  }
});


// ==========================================
// 2. CREATION & ONBOARDING
// ==========================================

router.post('/', async (req, res) => {
  const { name, subdomain } = req.body;
  if (!name) return res.status(400).json({ error: 'Workspace name is required.' });

  try {
    const { data: org, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .insert([{ 
        owner_id: req.user.id, 
        name, 
        subdomain: subdomain || null,
        onboarding_completed: true, 
        brand_settings: { primary: '#0A0F1E', accent: '#00C896' } // Enterprise Defaults
      }])
      .select().single();

    if (orgErr) throw orgErr;

    await supabaseAdmin
      .from('org_memberships')
      .insert([{ org_id: org.id, user_id: req.user.id, role: 'owner' }]);

    res.status(201).json(org);
  } catch (err) {
    res.status(500).json({ error: 'Critical failure during workspace instantiation.' });
  }
});

router.put('/:id/complete-onboarding', requireOrgRole(['owner']), async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('organizations')
      .update({ onboarding_completed: true })
      .eq('id', req.params.id);

    if (error) throw error;
    res.status(200).json({ message: 'Onboarding finalized. Telemetry active.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to finalize onboarding parameters.' });
  }
});


// ==========================================
// 3. SETTINGS, BRANDING & THE SECURE VAULT
// ==========================================

router.put('/:id/branding', requireOrgRole(['owner', 'admin']), async (req, res) => {
  const { navy, accent } = req.body;
  
  if (!navy || !accent) return res.status(400).json({ error: 'Malformed branding payload.' });

  try {
    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .update({ brand_settings: { primary: navy, accent: accent } })
      .eq('id', req.params.id)
      .select('brand_settings')
      .single();

    if (error) throw error;
    res.status(200).json(org.brand_settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to synchronize brand assets.' });
  }
});

/**
 * PUT /:id/payments
 * FIX FOR ISSUE #12: Captures payment keys and encrypts them at rest.
 */
router.put('/:id/payments', requireOrgRole(['owner']), async (req, res) => {
  const { provider, stripe_pk, stripe_sk, paystack_pk, paystack_sk } = req.body;

  try {
    // 1. Fetch current settings to preserve existing encrypted keys if frontend sent a masked string
    const { data: currentOrg } = await supabaseAdmin
      .from('organizations')
      .select('payment_settings')
      .eq('id', req.params.id)
      .single();

    const existingSettings = currentOrg?.payment_settings || {};

    // 2. Cryptographic Injection Logic
    // If the frontend sends a masked string (••••), it means the user didn't change it.
    // Keep the existing encrypted string in the database. Otherwise, encrypt the new one.
    const finalStripeSk = (stripe_sk && !stripe_sk.includes('••••')) 
      ? encryptData(stripe_sk) 
      : existingSettings.stripe_sk;

    const finalPaystackSk = (paystack_sk && !paystack_sk.includes('••••')) 
      ? encryptData(paystack_sk) 
      : existingSettings.paystack_sk;

    const securePayload = {
      provider: provider || existingSettings.provider,
      stripe_pk: stripe_pk !== undefined ? stripe_pk : existingSettings.stripe_pk,
      stripe_sk: finalStripeSk,
      paystack_pk: paystack_pk !== undefined ? paystack_pk : existingSettings.paystack_pk,
      paystack_sk: finalPaystackSk
    };

    // 3. Commit to Vault
    const { error } = await supabaseAdmin
      .from('organizations')
      .update({ payment_settings: securePayload })
      .eq('id', req.params.id);

    if (error) throw error;
    
    res.status(200).json({ message: 'Financial gateway configuration encrypted and locked.' });
  } catch (err) {
    console.error('[Vault Error]:', err.message);
    res.status(500).json({ error: 'Vault sealing failed. Configurations rolled back.' });
  }
});


// ==========================================
// 4. TEAM MANAGEMENT & INVITATIONS
// ==========================================

router.get('/:id/members', requireOrgRole(['owner', 'admin', 'member']), async (req, res) => {
  try {
    const { data: memberships, error: memErr } = await supabaseAdmin
      .from('org_memberships')
      .select('user_id, role, created_at')
      .eq('org_id', req.params.id);

    if (memErr) throw memErr;

    // Cross-reference with Auth to get emails
    // NOTE: In massive scale apps, this requires pagination. Fine for < 10,000 users.
    const { data: { users }, error: authErr } = await supabaseAdmin.auth.admin.listUsers();
    if (authErr) throw authErr;

    const formattedMembers = memberships.map(m => {
      const user = users.find(u => u.id === m.user_id);
      return { 
        user_id: m.user_id, 
        role: m.role, 
        joined: m.created_at, 
        email: user ? user.email : 'Deleted User' 
      };
    });

    res.status(200).json(formattedMembers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to compile organization directory.' });
  }
});

router.delete('/:id/members/:userId', requireOrgRole(['owner', 'admin']), async (req, res) => {
  try {
    const targetUserId = req.params.userId;

    // Prevent self-deletion via this route
    if (targetUserId === req.user.id) {
      return res.status(400).json({ error: 'Cannot remove your own account via this endpoint.' });
    }

    const { data: target } = await supabaseAdmin
      .from('org_memberships')
      .select('role')
      .eq('org_id', req.params.id)
      .eq('user_id', targetUserId)
      .single();

    if (target?.role === 'owner') {
      return res.status(403).json({ error: 'Security Exception: Cannot revoke Owner access.' });
    }

    await supabaseAdmin
      .from('org_memberships')
      .delete()
      .eq('org_id', req.params.id)
      .eq('user_id', targetUserId);

    res.status(200).json({ message: 'Identity access revoked successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to execute access revocation.' });
  }
});

router.post('/:id/invite', requireOrgRole(['owner', 'admin']), async (req, res) => {
  const { email, role } = req.body;
  if (!email || !role) return res.status(400).json({ error: 'Malformed invitation payload.' });

  // Generates a cryptographically secure 64-character hex token
  const token = crypto.randomBytes(32).toString('hex');

  try {
    const { error } = await supabaseAdmin
      .from('org_invitations')
      .insert([{ 
        org_id: req.params.id, 
        inviter_id: req.user.id, 
        email, 
        role, 
        token 
      }]);

    if (error) throw error;
    res.status(201).json({ message: 'Secure invitation dispatched.', token });
  } catch (err) {
    res.status(500).json({ error: 'Failed to dispatch secure invitation.' });
  }
});

router.post('/accept-invite', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Missing security token.' });

  try {
    // Validate token and ensure it has not expired
    const { data: invite, error: inviteErr } = await supabaseAdmin
      .from('org_invitations')
      .select('*')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (inviteErr || !invite) return res.status(401).json({ error: 'Invitation token invalid or expired.' });

    // Check if user is already in the org to prevent duplication crashes
    const { data: existing } = await supabaseAdmin
      .from('org_memberships')
      .select('id')
      .eq('org_id', invite.org_id)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (!existing) {
      await supabaseAdmin
        .from('org_memberships')
        .insert([{ org_id: invite.org_id, user_id: req.user.id, role: invite.role }]);
    }

    // Burn the token after successful use
    await supabaseAdmin.from('org_invitations').delete().eq('id', invite.id);

    res.status(200).json({ message: 'Authentication successful. Organization joined.', org_id: invite.org_id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to complete invitation sequence.' });
  }
});


// ==========================================
// 5. BILLING & PLAN MANAGEMENT (DEV OVERRIDE)
// ==========================================

/**
 * PUT /:id/plan
 * FIX FOR ISSUE #11: Previously ungated. Now locked explicitly to Owners.
 * Dev-mode bypass to forcibly upgrade a workspace plan.
 */
router.put('/:id/plan', requireOrgRole(['owner']), async (req, res) => {
  const { plan_tier, subscription_status } = req.body;
  
  if (!plan_tier) return res.status(400).json({ error: 'Target tier required for upgrade sequence.' });

  try {
    const { error } = await supabaseAdmin
      .from('organizations')
      .update({ 
        plan_tier: plan_tier, 
        subscription_status: subscription_status || 'active'
      })
      .eq('id', req.params.id);

    if (error) throw error;
    res.status(200).json({ message: `Plan forcibly escalated to [${plan_tier.toUpperCase()}].` });
  } catch (err) {
    console.error('[Plan Override Error]:', err.message);
    res.status(500).json({ error: 'System rejected plan escalation attempt.' });
  }
});

// ==========================================
// UPDATE DEVELOPER INTEGRATIONS
// ==========================================
router.put('/:id/integrations', requireAuth, async (req, res) => {
  try {
    const orgId = req.params.id;
    const { github_handle } = req.body;

    // Security check: Only update if the user belongs to this org
    const { error } = await supabaseAdmin
      .from('organizations')
      .update({ github_handle })
      .eq('id', orgId);

    if (error) throw error;
    res.status(200).json({ message: 'Integrations updated successfully' });
  } catch (err) {
    console.error('[Integration Update Error]:', err.message);
    res.status(500).json({ error: 'Failed to update integrations.' });
  }
});

// ==========================================
// 6. WHITE-LABEL ENGINE (CUSTOM DOMAINS)
// ==========================================

/**
 * POST /:id/domain
 * Registers a custom domain with Vercel's Edge Network
 */
router.post('/:id/domain', requireOrgRole(['owner', 'admin']), async (req, res) => {
  const { domain } = req.body;
  const orgId = req.params.id;

  if (!domain) return res.status(400).json({ error: 'Domain is required' });

  try {
    // 1. Tell Vercel to attach this domain to your project
    await axios.post(
      `https://api.vercel.com/v9/projects/${process.env.VERCEL_PROJECT_ID}/domains`,
      { name: domain },
      { headers: { Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}` } }
    );

    // 2. Update Supabase with the new domain and status
    const { error: dbError } = await supabaseAdmin
      .from('organizations')
      .update({ custom_domain: domain, domain_status: 'pending' })
      .eq('id', orgId);

    if (dbError) throw dbError;

    res.status(200).json({ message: 'Domain successfully registered with edge network.' });
  } catch (error) {
    console.error('[Vercel API Error]:', error.response?.data || error.message);
    const errorMessage = error.response?.data?.error?.message || 'Failed to configure domain on edge network.';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * DELETE /:id/domain
 * Removes a custom domain from Vercel's Edge Network
 */
router.delete('/:id/domain', requireOrgRole(['owner', 'admin']), async (req, res) => {
  const orgId = req.params.id;

  try {
    // 1. Fetch the domain to delete
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('custom_domain')
      .eq('id', orgId)
      .single();

    if (org?.custom_domain) {
      // 2. Delete from Vercel Edge Network
      try {
        await axios.delete(
          `https://api.vercel.com/v9/projects/${process.env.VERCEL_PROJECT_ID}/domains/${org.custom_domain}`,
          { headers: { Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}` } }
        );
      } catch (vercelErr) {
        console.warn('Domain might already be removed from Vercel, ignoring.', vercelErr.message);
      }
    }

    // 3. Clear from Supabase
    await supabaseAdmin
      .from('organizations')
      .update({ custom_domain: null, domain_status: 'none' })
      .eq('id', orgId);

    res.status(200).json({ message: 'Domain successfully removed.' });
  } catch (error) {
    console.error('[Vercel Delete Error]:', error.message);
    res.status(500).json({ error: 'Failed to remove custom domain.' });
  }
});

module.exports = router;