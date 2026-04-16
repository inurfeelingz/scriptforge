// backend/src/utils/supabase.js
const { createClient } = require('@supabase/supabase-js');

// Service role client — full DB access, bypasses RLS
// Only used server-side. Never expose this key to the frontend.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: { persistSession: false },
  }
);

// Create a client scoped to a specific user (respects RLS)
function userClient(accessToken) {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    {
      auth: { persistSession: false },
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    }
  );
}

module.exports = { supabase, userClient };
