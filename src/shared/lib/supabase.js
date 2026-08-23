/* ===========================================
   SUPABASE CONFIG
   Two separate Supabase projects:
     - Snippets DB  → direct Supabase URL (RLS enforces security)
     - Clipboard DB → direct Supabase URL (RLS enforces security)
   Anon keys are safe to expose on the frontend.
   Real security lives in Supabase Row Level Security (RLS) policies.
============================================ */

/* -- Snippets project -- */
const SUPABASE_SNIPPETS_URL = 'https://raxnqglobvykqylejibx.supabase.co';
const SUPABASE_SNIPPETS_KEY = 'sb_publishable_zyQ4xqqrd5yGLGBdC73lsA_PYqqHGRb';

/* -- Clipboard project -- */
const SUPABASE_CLIPBOARD_URL = 'https://vbtzptvgbzsvrustnwiz.supabase.co';
const SUPABASE_CLIPBOARD_KEY = 'sb_publishable_C_9ftqCYFtiwKuQTDnRBXg_mC3ypDYJ';
