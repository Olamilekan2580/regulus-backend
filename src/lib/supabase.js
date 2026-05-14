const { createClient } = require('@supabase/supabase-js');

// --- THE DIAGNOSTIC PROBE ---
console.log("=== RENDER ENVIRONMENT DIAGNOSTIC ===");
console.log("Looking for SUPABASE_URL:", process.env.SUPABASE_URL ? "✅ FOUND" : "❌ MISSING");
console.log("Looking for SUPABASE_SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "✅ FOUND" : "❌ MISSING");

// This prints every single variable name Render currently holds in its memory
console.log("Available Keys in Render:", Object.keys(process.env).filter(key => key.includes('SUPABASE') || key.includes('VITE')).join(', '));
console.log("=====================================");

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[CRITICAL] Missing Supabase environment variables. Crashing intentionally.');
  process.exit(1); // Force crash after logging
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = supabase;