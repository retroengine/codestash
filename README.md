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
| Frontend | Vanilla HTML/CSS/JS (`index.html`, `styles.css`, `app.js`) |
| Backend | Thin Node.js proxy (`api/admin/*.js`), deployed as Vercel Serverless Functions |
| Auth | Supabase Auth |
| Database | Supabase Postgres (REST API) |
| File Storage | Supabase Storage |
| Fonts | DM Sans + DM Mono (Google Fonts) |

Almost everything still talks to Supabase directly from the browser, protected by
Row Level Security — that hasn't changed. The one exception is the admin portal:
the admin passphrase is verified server-side by `api/admin/login.js` and never
shipped to the client, and the other admin actions (site lock, guest features,
user approve/reject) are proxied through `api/admin/*.js` so they forward the
admin's own session token rather than duplicating any authorization logic. See
[Configuration](#configuration) for the env vars this requires.

---

## Project Structure

```
index.html              HTML shell (head, auth/admin/app markup)
styles.css               All styling
app.js                    All frontend logic — auth, snippets, admin, clipboard, quick notes
api/
├── admin/login.js         POST — verifies the admin passphrase server-side, then Supabase auth
├── admin/site-settings.js GET/PATCH — site lock + guest feature toggles
├── admin/users.js          GET — list users pending/approved/rejected
└── admin/users/[id].js     PATCH — approve/reject/revoke a user
dev-server.js            Local Express stand-in for the Vercel functions above (`npm run dev`)
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

Two separate places now need config — the frontend (still hardcoded, since there's
still no build step) and the backend (real environment variables, since `api/*.js`
runs in a Node runtime).

### Frontend — `app.js`

The snippet-library Supabase URL/anon key and the clipboard project's URL/key are
near the top of `app.js` and in the `ONLINE CLIPBOARD` section respectively. These
are the **anon/public** keys from Supabase → Settings → API — safe to ship to the
browser because Row Level Security (RLS) enforces all access rules at the database
level for every call they make.

```js
const _c = 'https://YOUR-PROJECT.supabase.co';
const _k = 'YOUR-ANON-KEY';
// ...
const CB_URL = 'https://YOUR-CLIPBOARD-PROJECT.supabase.co';
const CB_KEY = 'YOUR-CLIPBOARD-ANON-KEY';
```

### Backend — environment variables

Copy `.env.example` to `.env` and fill in:

```
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR-ANON-KEY
ADMIN_PASSPHRASE=your-secret-passphrase
```

`SUPABASE_URL`/`SUPABASE_ANON_KEY` here are the **same** snippet-library project
values as above — `api/*.js` needs its own copy since it can't read `app.js`.
`ADMIN_PASSPHRASE` is the admin-portal gate; it's checked entirely server-side in
`api/admin/login.js` and is never sent to the browser. Pick a fresh value — the
old hardcoded passphrase is permanently readable in this repo's git history, so
reusing it doesn't actually protect anything.

`.env` is git-ignored. For local dev: `npm install && npm run dev` (runs
`dev-server.js`, an Express stand-in for the Vercel functions, on `:3000`). On
Vercel: Project → Settings → Environment Variables, add the same three, then
redeploy.

---

## Deployment

The app is a static frontend (`index.html`/`styles.css`/`app.js`) plus a handful
of Vercel Serverless Functions in `api/` — Vercel is the only target set up for
this out of the box (no `vercel.json` needed, it detects the `api/` layout on its
own):

1. Connect the repo on [vercel.com](https://vercel.com) (or push — if already
   connected via GitHub integration, every push deploys automatically).
2. Add the three environment variables above under Project Settings.
3. **Deployment Protection**: by default a new Vercel project may have
   "Vercel Authentication" enabled, which puts the whole site behind a login
   wall even though it deployed successfully — check Project → Settings →
   Deployment Protection and turn it off for Production if you want the site
   actually public.

Other static hosts (GitHub Pages, Netlify, Cloudflare Pages) can still serve
`index.html`/`styles.css`/`app.js`, but the admin portal won't work there since
they don't run `api/*.js` — only the snippet library (as a regular signed-in
user) and the Online Clipboard would function.

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

- The admin passphrase lives only in the `ADMIN_PASSPHRASE` env var and is checked
  server-side in `api/admin/login.js` — it is never present in `app.js` or any
  page source shipped to the browser
- All data access is additionally enforced by Supabase RLS policies at the
  database level, not just the frontend or the API routes
- The clipboard is intentionally anonymous — security relies on the OTP being unguessable (1-in-10,000 odds)
- The app blocks DevTools (right-click, F12, Ctrl+Shift+I) to deter casual inspection
- Failed login attempts are rate-limited (5 attempts max per session)
- The Supabase anon key in `app.js` is expected to be public/committed — it's
  designed to be safe as long as RLS policies are correct (see the SQL above)
- If this repo has ever had a *real* admin passphrase or service-role key
  committed to it, rotating the value going forward does **not** remove it from
  git history — anyone can still read old commits. Purge history
  (`git filter-repo`/BFG) if that matters for your deployment

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
