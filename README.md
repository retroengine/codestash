# CodeStash

A self-hosted, private snippet library and online clipboard — built as a single HTML file powered by Supabase.

---

## Features

### Snippet Library
- Save, edit, and delete code snippets with syntax labels
- Supports Python, JavaScript, Java, C++, SQL, HTML, CSS, Notes, and custom languages
- Search snippets in real time
- Auto-refresh every 30 seconds (delta fetch — only new rows downloaded)
- Admin-approved user access system

### Online Clipboard
- Paste text or upload a file (up to 15 MB) and receive a 4-digit retrieval code
- Codes are easy-to-type patterns: pairs (`1122`), mirrors (`3443`), sequences (`2345`), alternating odds/evens (`1357`), etc.
- Retrieve content from any device using the code
- All clipboard data auto-deletes after 24 hours
- Uses a **separate** Supabase project from the snippet library

---

## Tech Stack

| Layer | Tool |
|---|---|
| Frontend | Vanilla HTML/CSS/JS (single file) |
| Auth | Supabase Auth |
| Database | Supabase Postgres (REST API) |
| File Storage | Supabase Storage |
| Fonts | DM Sans + DM Mono (Google Fonts) |

---

## Project Structure

Everything lives in **one file**: `index.html`

Internally it's organized as:

```
index.html
├── CSS tokens & global styles
├── Auth screen (Sign In / Sign Up / Admin)
├── Pending approval screen
├── Admin portal (user management, site lock)
├── App layout
│   ├── Sidebar (Snippets nav, Online Clipboard nav)
│   ├── Topbar (status, user dropdown)
│   ├── Snippets panel (add, search, grid)
│   └── Clipboard panel (upload, retrieve)
├── Script — CodeStash (Supabase project #1)
└── Script — Online Clipboard (Supabase project #2)
```

---

## Supabase Setup

CodeStash uses **two separate Supabase projects**.

### Project 1 — Snippet Library

Run this SQL in your first Supabase project:

```sql
-- 1. Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_read_own"   ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "admin_read_all"  ON profiles FOR SELECT USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
CREATE POLICY "admin_update"    ON profiles FOR UPDATE USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
CREATE POLICY "user_insert_own" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- 2. Site settings table
CREATE TABLE IF NOT EXISTS site_settings (
  id int PRIMARY KEY DEFAULT 1,
  locked boolean NOT NULL DEFAULT true,
  updated_at timestamptz DEFAULT now()
);
INSERT INTO site_settings (id, locked) VALUES (1, true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_settings" ON site_settings FOR SELECT USING (true);
CREATE POLICY "admin_update_settings" ON site_settings FOR UPDATE USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- 3. Snippets table
CREATE TABLE IF NOT EXISTS snippets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  language text NOT NULL DEFAULT 'text',
  code text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE snippets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approved_select" ON snippets FOR SELECT USING (auth.uid() IS NOT NULL AND (auth.uid() = user_id OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')));
CREATE POLICY "approved_insert" ON snippets FOR INSERT WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status = 'approved'));
CREATE POLICY "approved_delete" ON snippets FOR DELETE USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- 4. Promote your first admin (run after signing up normally)
-- UPDATE profiles SET role = 'admin', status = 'approved' WHERE email = 'your@email.com';
```

---

### Project 2 — Online Clipboard

Run this SQL in your **second** Supabase project:

```sql
-- 1. Clipboard entries table
CREATE TABLE IF NOT EXISTS clipboard_entries (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  otp        char(4) NOT NULL UNIQUE,
  content    text,
  file_url   text,
  file_name  text,
  file_type  text,
  type       text NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'file')),
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '24 hours')
);

CREATE INDEX idx_clipboard_otp     ON clipboard_entries(otp);
CREATE INDEX idx_clipboard_expires ON clipboard_entries(expires_at);

ALTER TABLE clipboard_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read"   ON clipboard_entries FOR SELECT USING (expires_at > now());
CREATE POLICY "public_insert" ON clipboard_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "public_delete" ON clipboard_entries FOR DELETE USING (true);

-- 2. Auto-cleanup trigger (fires on every insert, purges expired rows)
CREATE OR REPLACE FUNCTION cleanup_expired_clipboard()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM clipboard_entries WHERE expires_at < now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cleanup_clipboard
  AFTER INSERT ON clipboard_entries
  FOR EACH STATEMENT
  EXECUTE FUNCTION cleanup_expired_clipboard();

-- 3. Storage bucket for file uploads
INSERT INTO storage.buckets (id, name, public)
VALUES ('clipboard-files', 'clipboard-files', true)
ON CONFLICT DO NOTHING;

CREATE POLICY "public_upload"     ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'clipboard-files');
CREATE POLICY "public_read_files" ON storage.objects FOR SELECT USING (bucket_id = 'clipboard-files');
```

> **Optional:** If your Supabase plan supports `pg_cron`, you can also schedule an hourly cleanup:
> ```sql
> SELECT cron.schedule('delete-expired-clipboard', '0 * * * *', $$DELETE FROM clipboard_entries WHERE expires_at < now()$$);
> ```

---

## Configuration

Open `index.html` and update the two config blocks near the top of the `<script>` section:

```js
// ── Snippet Library (Project #1)
const _c = 'https://YOUR-PROJECT.supabase.co';
const _k = 'YOUR-ANON-KEY';
const _adminPhrase = 'your-secret-passphrase';

// ── Online Clipboard (Project #2)
const CB_URL = 'https://YOUR-CLIPBOARD-PROJECT.supabase.co';
const CB_KEY = 'YOUR-CLIPBOARD-ANON-KEY';
```

Both keys are the **anon/public** keys from Supabase → Settings → API. They are safe to use in frontend code because Row Level Security (RLS) enforces all access rules at the database level.

---

## Deployment

Since everything is a single HTML file, deployment is straightforward:

- **GitHub Pages** — push `index.html` to a repo and enable Pages
- **Netlify / Vercel** — drop the file or connect a repo
- **Cloudflare Pages** — same as above
- **Self-hosted** — serve it from any static file host or Nginx/Caddy

No build step, no dependencies, no Node.js required.

---

## User Flow

### Snippet Library

1. User visits the site
2. If site is **locked** → must sign in (Sign In / Sign Up tabs)
3. New sign-ups land in **pending** status until an admin approves them
4. Approved users can create, edit, copy, and delete their own snippets
5. Session expires after **30 minutes of inactivity**

### Admin Portal

1. Sign in via the **Admin** tab using your email + secret passphrase
2. Approve or reject pending users
3. Toggle site lock (locked = login required, unlocked = public read access)

### Online Clipboard

1. Click **Online Clipboard** in the left sidebar
2. **Upload tab** — paste text or drop a file → click Generate Code → share the 4-digit code
3. **Retrieve tab** — type the 4-digit code in the boxes → content or download link appears instantly
4. Entries auto-delete after 24 hours — no manual cleanup needed

---

## Security Notes

- Change `_adminPhrase` before deploying — the default is a placeholder
- All data access is enforced by Supabase RLS policies, not just the frontend
- The clipboard is intentionally anonymous — security relies on the OTP being unguessable (1-in-10,000 odds)
- The app blocks DevTools (right-click, F12, Ctrl+Shift+I) to deter casual inspection
- Failed login attempts are rate-limited (5 attempts max per session)
- Never commit your Supabase anon key to a public repo if you've hardcoded it — use environment variables or a build step instead

---

## File Size Limits

| Type | Limit |
|---|---|
| Clipboard text | Unlimited (Postgres `text` column) |
| Clipboard file upload | 15 MB |
| Snippet code | Unlimited (Postgres `text` column) |

---

## License

MIT — use it, fork it, self-host it.
