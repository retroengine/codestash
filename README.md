# ⚡ CodeStash

A self-hosted code snippet manager. Save, search, and copy your code snippets — with admin-controlled access so only approved people can use it.

Single HTML file. No install. No build step. Powered by Supabase.

---

## What you need

- A free [Supabase](https://supabase.com) account
- A way to host a static HTML file (GitHub Pages, Netlify, anywhere)
- 10 minutes

---

## Setup

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com) → New Project → wait for it to spin up.

### 2. Run the database SQL

In your Supabase dashboard → **SQL Editor** → paste and run the contents of `supabase_setup.sql`.

This creates three tables (`profiles`, `site_settings`, `snippets`) with all the security rules.

### 3. Configure the HTML file

Open `index.html` and find this section near the top of the `<script>`:

```js
const _c = 'https://your-project.supabase.co';   // ← your Project URL
const _k = 'your-anon-key';                        // ← your anon public key
const _adminPhrase = 'codestash-admin-2025';        // ← change this!
```

Get your URL and anon key from: Supabase → **Settings → API**.

> ⚠️ Change `_adminPhrase` to something only you know before deploying.

### 4. Deploy

Upload `index.html` anywhere that serves static files. GitHub Pages, Netlify drag-and-drop, Vercel — all work fine.

---

## Creating your admin account

1. Open the app → **Sign Up** tab → register with your email and password
2. Go to Supabase → **SQL Editor** → run:

```sql
UPDATE profiles
SET role = 'admin', status = 'approved'
WHERE email = 'your-email@example.com';
```

3. Back in the app → click the **⚙ Admin** tab → sign in with your email, password, and your admin passphrase

That's it. You're in.

> If you see "User already registered" on signup, your account already exists — just go straight to the Admin tab and sign in.

> If you see "Access denied", your profile row is missing or has the wrong role. Run the `UPDATE` query above (or `INSERT` if the profiles table is empty — see Troubleshooting below).

---

## How it works

| Role | What they can do |
|------|-----------------|
| **Admin** | Approve/reject users, lock or unlock the site, view all snippets |
| **Approved user** | Save, search, copy, and delete their own snippets |
| **Pending user** | Nothing — sees a waiting screen until approved |
| **Public** (site unlocked) | Read-only view of snippets, no login needed |

New signups are always **pending** until an admin approves them from the Admin Portal.

---

## Admin Portal

Log in via the **⚙ Admin** tab. You'll need your email, password, and the admin passphrase.

From the portal you can:
- **Approve or reject** pending users
- **Revoke** access from existing users
- **Lock/unlock** the site — unlocked means anyone can view snippets without logging in

---

## Customisation

| What | Where |
|------|-------|
| Admin passphrase | `const _adminPhrase = '...'` |
| Session timeout | `const INACTIVITY_TIMEOUT = 30 * 60 * 1000` (milliseconds) |
| Snippet languages | `<select id="snippetLang">` in the HTML |
| Colours / fonts | CSS variables at the top of `<style>` |

---

## Troubleshooting

**"User already registered" on signup**
Your account exists in Supabase Auth but has no profile row. Run this in SQL Editor:
```sql
-- First get your user ID
SELECT id FROM auth.users WHERE email = 'your-email@example.com';

-- Then insert the profile
INSERT INTO profiles (id, email, role, status)
VALUES ('paste-id-here', 'your-email@example.com', 'admin', 'approved');
```

**"Access denied" on admin login**
Your profile exists but doesn't have admin role. Fix it:
```sql
UPDATE profiles SET role = 'admin', status = 'approved'
WHERE email = 'your-email@example.com';
```

**Snippets not loading**
Check that the Supabase URL and anon key in `index.html` are correct. You can verify in Supabase → Settings → API.

**SQL setup failed with "relation does not exist"**
Make sure you're running `supabase_setup.sql` in full, top to bottom, in one go. The order matters — tables must exist before the functions and policies that reference them.

---

## Security notes

- The admin passphrase in `index.html` is client-side — anyone can view it in source. Change it, but don't treat it as your only security. The real protection is Supabase Row Level Security (RLS), which enforces access at the database level regardless of what the client does.
- The anon key in the HTML is safe to expose — it's designed to be public. RLS policies control what it can actually access.
- Sessions auto-expire after 30 minutes of inactivity.

---

## Stack

- **Frontend** — vanilla HTML, CSS, JavaScript. Zero dependencies.
- **Backend** — [Supabase](https://supabase.com) (Postgres + Auth + REST API)
- **Auth** — Supabase Auth with a custom approval layer on top
- **Hosting** — any static host
