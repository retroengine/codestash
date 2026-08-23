# CodeStash

Your own snippet library, an anonymous online clipboard, and a scratchpad for notes — one small app, no framework, no build step.

**Live site:** https://<YOUR_DEPLOYMENT_URL>.vercel.app

---

## What it does

- **Snippets** — save, tag, search, pin, and share code with syntax highlighting
- **Online Clipboard** — paste text or drop a file, get a 4-digit code, grab it from any device. Gone in 24h.
- **Quick Notes** — a 4-tab scratchpad with a markdown-ish toolbar and fullscreen mode
- **Auth with approval** — sign up, then wait for an admin to approve you before you can post
- **Admin panel** — approve/reject users, lock the whole site, toggle guest access
- **Light/dark mode**, saved per device

---

## How it's built, and why

```
Browser  ──direct──▶  Supabase (Snippets DB: auth, profiles, snippets, site_settings)
   │                  Supabase (Clipboard DB: anonymous, OTP-keyed, auto-expiring)
   │
   └──/api/admin/*──▶  Vercel serverless functions ──▶  Supabase (server-side only)
```

No custom backend sits between the browser and the data for normal use — Supabase's **Row Level Security (RLS)** is the actual security boundary, not the JavaScript. The anon key in the frontend is meant to be public; it's useless without RLS policies granting access.

The **admin passphrase** is the one thing that can't live in the browser, so it doesn't: typing it in the Admin tab calls `POST /api/admin/login`, a Vercel function that checks it against a server-only env var, then authenticates you against Supabase and confirms your account has `role = 'admin'`. Three checks, none of them trusting the client.

A few choices that shape the rest of the code:

| Choice | Why |
|---|---|
| Two separate Supabase projects | Clipboard is anonymous and ephemeral — no auth, no user data. Keeping it in its own project means a bug there can't touch your snippets or accounts. |
| New users start `pending` | Open signup with instant write access to a public snippet feed is an easy way to get spammed. An admin has to approve you first. |
| Client-side login rate limiting | 5 failed attempts locks the form for a while — cheap protection against passphrase/password guessing directly in the browser. |
| Vanilla JS, no framework | It's a small app. A build step would add tooling to maintain without solving a problem this app actually has. |
| Security headers via `vercel.json` | CSP, HSTS, frame/content-type protections — set once at the platform level so every response gets them, not just the ones you remembered to handle in code. |

There's also a hidden `/zoo` route and an `npm run treat` script. Not documented further than that — go look.

---

## Current status (the honest part)

There's a **second, independent backend** in [server/](server/) — Node/Express + Postgres, JWT auth, bcrypt, full-text search, cursor pagination, a cron job that clears expired clipboard entries. It's real and it works (curl-verified, see [LEARNING.md](LEARNING.md)).

It is **not connected to the frontend yet.** The site you see still talks to Supabase directly, exactly as described above. Rewiring the frontend to call this API instead — and picking somewhere to host it — is future work, not an oversight.

---

## Run it locally

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL and JWT_SECRET — only needed for server/
npm run dev                # nodemon server/server.js — API on http://localhost:4000
```

To open the site itself, just serve `index.html` (e.g. `npx serve .`) — it needs no backend of its own, only Supabase.

To test the admin API functions locally the way Vercel runs them:
```bash
node dev-server.js         # http://localhost:3000
```

---

## Deploy (Vercel)

No build step — static files plus `api/` serverless functions, auto-detected.

Set these as environment variables on the Vercel project (Project Settings → Environment Variables), never in a committed file:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Your **Snippets** project URL — this is what `api/admin/*` talks to |
| `SUPABASE_ANON_KEY` | That project's anon/publishable key |
| `ADMIN_PASSPHRASE` | Whatever passphrase you want to gate the Admin tab with |

```bash
npm i -g vercel
vercel login
vercel link
vercel env add SUPABASE_URL production
vercel env add SUPABASE_ANON_KEY production
vercel env add ADMIN_PASSPHRASE production
vercel --prod
```

---

## Database setup (Supabase)

Two projects. Run each block in that project's SQL editor.

**Project 1 — Snippets** (profiles, site settings, snippets, RLS policies):
```sql
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

CREATE TABLE IF NOT EXISTS site_settings (
  id int PRIMARY KEY DEFAULT 1,
  locked boolean NOT NULL DEFAULT true,
  updated_at timestamptz DEFAULT now()
);
INSERT INTO site_settings (id, locked) VALUES (1, true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_settings" ON site_settings FOR SELECT USING (true);
CREATE POLICY "admin_update_settings" ON site_settings FOR UPDATE USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

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

-- after signing up normally, promote yourself:
-- UPDATE profiles SET role = 'admin', status = 'approved' WHERE email = 'your@email.com';
```

**Project 2 — Clipboard** (anonymous, self-cleaning):
```sql
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

INSERT INTO storage.buckets (id, name, public)
VALUES ('clipboard-files', 'clipboard-files', true)
ON CONFLICT DO NOTHING;
CREATE POLICY "public_upload"     ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'clipboard-files');
CREATE POLICY "public_read_files" ON storage.objects FOR SELECT USING (bucket_id = 'clipboard-files');
```

---

## Security notes

- The admin passphrase lives only in the `ADMIN_PASSPHRASE` env var, checked server-side in `api/admin/login.js` — never in a file the browser downloads
- Every data access is enforced by Supabase RLS, not just by whether the UI happens to show a button
- Clipboard entries are anonymous by design — security is the OTP being 1-in-10,000 to guess, plus the 24h expiry
- If a real secret was ever committed to this repo's history, rotating it going forward doesn't erase it from old commits — use `git filter-repo` or the BFG Repo-Cleaner if that matters to you

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS, highlight.js, qrcodejs |
| Data | Supabase (Postgres + Auth + Storage), via RLS |
| Admin functions | Vercel serverless functions (Node) |
| New backend (not yet wired in) | Node/Express, `pg`, JWT + bcrypt, Zod, node-cron — see [server/](server/) |
| Hosting | Vercel |

---

## License

MIT — use it, fork it, self-host it.
