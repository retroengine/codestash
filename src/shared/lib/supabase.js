/* ===========================================
   SUPABASE CONFIG
   Two separate Supabase projects:
     - Snippets DB  → direct Supabase URL (RLS enforces security)
     - Clipboard DB → direct Supabase URL (RLS enforces security)
   Anon keys are safe to expose on the frontend.
   Real security lives in Supabase Row Level Security (RLS) policies.
============================================ */

/* -- Snippets project -- */
const SUPABASE_SNIPPETS_URL = 'https://<YOUR_SNIPPETS_SUPABASE_PROJECT_ID>.supabase.co';
const SUPABASE_SNIPPETS_KEY = '<YOUR_SNIPPETS_SUPABASE_ANON_KEY>';

/* -- Clipboard project -- */
const SUPABASE_CLIPBOARD_URL = 'https://<YOUR_CLIPBOARD_SUPABASE_PROJECT_ID>.supabase.co';
const SUPABASE_CLIPBOARD_KEY = '<YOUR_CLIPBOARD_SUPABASE_ANON_KEY>';
