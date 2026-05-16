const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('[FATAL ERROR]: Missing Supabase URL or Service Key in .env');
  process.exit(1);
}

// --- DIAGNOSTIC TRAP START ---
try {
  // A Supabase key is just a JWT. This cracks it open to see what identity it actually holds.
  const payload = JSON.parse(Buffer.from(supabaseKey.split('.')[1], 'base64').toString());
  console.log(`\n=========================================`);
  console.log(`[SYSTEM BOOT] SUPABASE KEY IDENTITY DETECTED:`);
  console.log(`[SYSTEM BOOT] Role: ${payload.role}`);
  console.log(`=========================================\n`);
} catch(e) {
  console.log(`[SYSTEM BOOT] FATAL: The key provided in SUPABASE_SERVICE_ROLE_KEY is not a valid JWT.`);
}
// --- DIAGNOSTIC TRAP END ---

// We use the Service Role key to securely bypass RLS from the backend
const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

module.exports = supabaseAdmin;