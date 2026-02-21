# ⚡ CodeStash

A self-hosted code snippet manager with admin-controlled access, user approval workflows, and site-wide lock/unlock — built as a single HTML file powered by Supabase.

---

## Features

- **Three-tier auth** — separate Sign In, Sign Up, and Admin login flows
- **Approval queue** — new signups are held in *pending* state until an admin approves them
- **Admin portal** — dedicated dashboard to manage users and control site access
- **Site lock/unlock** — admin can open the site to the public (no login needed) or lock it down to approved users only
- **Security hardened** — rate limiting, input sanitization, inactivity timeout, XSS protection, and Supabase Row Level Security
- **Snippet manager** — save, search, copy, and delete code snippets with language tagging
- Zero dependencies, no build step — just one `.html` file

---

## Getting Started

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com) and create a free project. Copy your **Project URL** and **anon public key** from `Settings → API`.

### 2. Configure the HTML file

Open `index.html` and update the two config values near the top of the `<script>` block:

```js
const _c = 'https://YOUR-PROJECT.supabase.co';   // your project URL
const _k = 'YOUR-ANON-KEY';                       // your anon/public key
```

Also change the admin passphrase to something secret:

```js
const _adminPhrase = 'your-secret-passphrase';
```

> **Note:** The passphrase is a client-side gate. Real access control is enforced by Supabase RLS policies on the server.

### 3. Run the SQL setup

In your Supabase dashboard go to **SQL Editor** and run the full SQL block found at the bottom of `index.html` (inside the HTML comment). It creates:

| Table | Purpose |
|---|---|
| `profiles` | Stores each user's role (`admin`/`user`) and status (`pending`/`approved`/`rejected`) |
| `site_settings` | Single-row table that holds the global site lock state |
| `snippets` | The code snippets with RLS scoped to approved users |

### 4. Create your first admin

After running the SQL, sign up once through the app normally, then run this in the Supabase SQL editor:

```sql
UPDATE profiles
SET role = 'admin', status = 'approved'
WHERE email = 'your-admin@email.com';
```

### 5. Deploy

Drop `index.html` anywhere — GitHub Pages, Netlify, Vercel, an S3 bucket, or just open it locally. No server required.

---

## How It Works

### Auth Flow

```
User visits site
      │
      ├─ Site unlocked? ──► Show app directly (public access)
      │
      └─ Site locked?
            │
            ├─ Sign In ──► Check profile status
            │                   ├─ pending  ──► Show waiting screen
            │                   ├─ rejected ──► Show error
            │                   └─ approved ──► Show app ✓
            │
            ├─ Sign Up ──► Create profile (status: pending)
            │              Show "awaiting approval" notice
            │
            └─ Admin ───► Passphrase check + role check
                          └─ role = admin ──► Admin portal ✓
```

### Admin Portal

The admin portal has two sections:

**Site Access Control**
A toggle switch that flips the `locked` field in the `site_settings` table. When unlocked, the site skips authentication entirely on page load and shows the app to everyone.

**User Management**
Filterable list of all registered users (Pending / Approved / Rejected / All). Each user card shows their email, join time, and current status with action buttons:

| Status | Available actions |
|---|---|
| Pending | Approve, Reject |
| Approved | Revoke |
| Rejected | Restore |

---

## Security

| Measure | Details |
|---|---|
| **Rate limiting** | 5 failed login attempts locks the form for 15 minutes (tracked in `sessionStorage`) |
| **Input sanitization** | Email, password, and text fields are validated and stripped of HTML/special characters |
| **XSS protection** | All user-generated content rendered via `escHtml()` which encodes `&`, `<`, `>`, `"`, `'` |
| **Inactivity timeout** | Session auto-expires after 30 minutes of no user activity |
| **Admin passphrase** | Extra credential required beyond email/password for admin login |
| **Supabase RLS** | Row Level Security policies enforce server-side access rules regardless of client-side code |
| **DevTools detection** | Overlay blocks access if browser developer tools are detected |
| **Anti-inspect** | Right-click, F12, and common devtools keyboard shortcuts are intercepted |

### RLS Policy Summary

```
profiles
  ├─ SELECT  users see own row; admins see all
  ├─ INSERT  users insert own row on signup
  └─ UPDATE  admins only

site_settings
  ├─ SELECT  public (needed for lock check on page load)
  └─ UPDATE  admins only

snippets
  ├─ SELECT  approved users + admins
  ├─ INSERT  approved users (own snippets only)
  └─ DELETE  own snippets; admins can delete any
```

---

## Customization

### Change the inactivity timeout

```js
const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes — adjust as needed
```

### Change the rate limit window

```js
const RATE_LIMIT = { max: 5, window: 15 * 60 * 1000 }; // 5 attempts per 15 min
```

### Add more snippet languages

Find the `<select id="snippetLang">` element in the HTML and add more `<option>` tags.

---

## Project Structure

```
index.html
│
├── CSS (embedded)
│   ├── Auth screen styles
│   ├── Admin portal styles
│   ├── App / snippet styles
│   └── Animations & responsive
│
├── HTML
│   ├── #authScreen        — login / signup / admin tabs
│   ├── #pendingScreen     — shown to unapproved users
│   ├── #adminPortal       — full admin dashboard
│   └── #appContainer      — main snippet manager
│
└── JavaScript (embedded IIFE)
    ├── Anti-inspect / DevTools detection
    ├── Rate limiting
    ├── Auth handlers (login, signup, admin)
    ├── Profile management (fetch, create, update)
    ├── Admin functions (lock toggle, user approval)
    ├── Snippet CRUD (fetch, save, delete, render)
    └── Utilities (toast, escHtml, relTime, inactivity)
```

---

## Requirements

- A [Supabase](https://supabase.com) project (free tier works)
- A modern browser (Chrome, Firefox, Safari, Edge)
- No Node.js, no npm, no build tools

---

## License

MIT — do whatever you want with it.
