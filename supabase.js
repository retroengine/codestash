/* ═══════════════════════════════════════════
   SUPABASE CONFIG
   Two separate Supabase projects are used:
     - Snippets DB  → proxied via /api/sb-snippets  (vercel.json rewrite)
     - Clipboard DB → proxied via /api/sb-clipboard (vercel.json rewrite)
   The anon keys below are safe to expose on the frontend.
   Real security lives in Supabase Row Level Security (RLS) policies.
════════════════════════════════════════════ */

/* ── Snippets project ── */
const SUPABASE_SNIPPETS_URL = '/api/sb-snippets';
const SUPABASE_SNIPPETS_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJheG5xZ2xvYnZ5a3F5bGVqaWJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NjE4NzksImV4cCI6MjA4NzUzNzg3OX0.ESup3R8G2TTizcdloSrSxi8XyopmSaHpUidVGCL3CVI';

/* ── Clipboard project ── */
const SUPABASE_CLIPBOARD_URL = '/api/sb-clipboard';
const SUPABASE_CLIPBOARD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZidHpwdHZnYnpzdnJ1c3Rud2l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMzY2NzksImV4cCI6MjA4NzYxMjY3OX0.25To041KTncq-3gRm0QB3qrGzeGyD1v9ODOCvh3i1Z0';
