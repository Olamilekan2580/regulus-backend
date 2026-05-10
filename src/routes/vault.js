const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabaseAdmin = require('../config/supabase');

const authModule = require('../middleware/auth');
const requireAuth = typeof authModule === 'function' ? authModule : authModule.requireAuth;

// We use aes-256-cbc. It requires a 32-byte key and a 16-byte Initialization Vector (IV).
const ALGORITHM = 'aes-256-cbc';

// Helper to ensure the key is properly formatted from the .env hex string
const getEncryptionKey = () => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('CRITICAL: ENCRYPTION_KEY is missing from environment variables.');
  return Buffer.from(key, 'hex');
};

router.use(requireAuth);

// ==========================================
// 1. GET ALL SECRETS (Metadata ONLY - No Data)
// ==========================================
router.get('/', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  if (!orgId) return res.status(400).json({ error: 'Organization context missing' });

  try {
    // We explicitly DO NOT select encrypted_value or iv here. 
    // We only want the metadata for the dashboard.
    const { data, error } = await supabaseAdmin
      .from('credential_vault')
      .select('id, secret_name, is_viewed, requires_burn, expires_at, created_at, clients(name)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json(data || []);
  } catch (err) {
    console.error('[Vault GET Error]:', err.message);
    res.status(500).json({ error: 'Failed to fetch vault metadata' });
  }
});

// ==========================================
// 2. CREATE A SECURE CREDENTIAL
// ==========================================
router.post('/', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  if (!orgId) return res.status(400).json({ error: 'Organization context missing' });

  try {
    const { client_id, project_id, secret_name, secret_value, requires_burn = true } = req.body;

    if (!secret_value) return res.status(400).json({ error: 'Secret value cannot be empty' });

    // ENCRYPTION ENGINE
    const iv = crypto.randomBytes(16); // Generate a unique IV for every single secret
    const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
    
    let encryptedValue = cipher.update(secret_value, 'utf8', 'hex');
    encryptedValue += cipher.final('hex');

    const { data, error } = await supabaseAdmin
      .from('credential_vault')
      .insert([{ 
        org_id: orgId, 
        client_id, 
        project_id, 
        secret_name, 
        encrypted_value: encryptedValue, 
        iv: iv.toString('hex'), // Save IV so we can decrypt it later
        requires_burn,
        created_by: req.user.id
      }])
      .select('id, secret_name, expires_at') // Return ONLY safe data
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('[Vault POST Error]:', err.message);
    res.status(500).json({ error: 'Failed to securely store credential' });
  }
});

// ==========================================
// 3. REVEAL & BURN
// ==========================================
router.post('/:id/reveal', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  if (!orgId) return res.status(400).json({ error: 'Organization context missing' });

  try {
    const { id } = req.params;

    // 1. Fetch the encrypted payload
    const { data: secretData, error } = await supabaseAdmin
      .from('credential_vault')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (error || !secretData) return res.status(404).json({ error: 'Secret not found or already destroyed' });

    // 2. Check Expiration
    if (new Date() > new Date(secretData.expires_at)) {
      // It's expired. Destroy it immediately before throwing the error.
      await supabaseAdmin.from('credential_vault').delete().eq('id', id);
      return res.status(410).json({ error: 'This secret has expired and was destroyed.' });
    }

    // 3. DECRYPTION ENGINE
    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(secretData.iv, 'hex'));
    let decryptedValue = decipher.update(secretData.encrypted_value, 'hex', 'utf8');
    decryptedValue += decipher.final('utf8');

    // 4. THE BURN PROTOCOL
    if (secretData.requires_burn) {
      // Completely erase the row from the database
      await supabaseAdmin.from('credential_vault').delete().eq('id', id);
    } else {
      // Just mark it as viewed if they opted out of burn-on-read
      await supabaseAdmin.from('credential_vault').update({ is_viewed: true }).eq('id', id);
    }

    // 5. Return the plaintext (This is the ONLY time it exists in plaintext)
    res.status(200).json({ 
      secret_name: secretData.secret_name, 
      secret_value: decryptedValue,
      burned: secretData.requires_burn
    });

  } catch (err) {
    console.error('[Vault Reveal Error]:', err.message);
    res.status(500).json({ error: 'Decryption sequence failed' });
  }
});

module.exports = router;