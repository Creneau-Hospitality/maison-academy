import { createClient } from '@supabase/supabase-js';

// Both values are designed to be public: every visitor's browser receives them.
// Access is controlled by row-level security in the database.
// Never put the service-role (secret) key or the database password here.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://dxipjlkledacoabdhrdg.supabase.co';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_xCA8XR-Vyh4fF7d2fjbsHw_kKfyrbbS';

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
