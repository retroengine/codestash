# CodeStash

A personal code snippet library with an online clipboard and quick notes — vanilla HTML/CSS/JS frontend,
backed by a Node/Express + Postgres API that owns auth, authorization, and the schema directly.

**Live site:** https://<YOUR_DEPLOYMENT_URL>.vercel.app

---

## ⚠ Current status

The **backend** (`server/`) is a working, curl-verified Express + Postgres API: JWT auth with bcrypt-hashed
passwords, server-side ownership checks, a migrated schema with indexes and full-text search, cursor
pagination, and a scheduled clipboard-expiry job. See [`LEARNING.md`](./LEARNING.md) for what was built and
verified, step by step.

The **frontend** (`src/`, `index.html`) has **not been rewired to it yet** — it still calls Supabase directly,
as it did before this backend existed. Pointing the frontend at `/auth` and `/snippets` instead is the next
piece of work, not something silently skipped.

Also: `npm run treat`. Just try it.

---

## Meet the crew

The `server/` code is run by a small forest of animals who each mind their own business.
Nobody asked for this, it just happened somewhere around the third migration file.

| | Animal | Job | Lives in |
|---|---|---|---|
| 🦉 | Owl | guards the door, checks every JWT, never blinks | `middleware/auth.js`, `services/auth.service.js` |
| 🦦 | Otter | cracks open every request to check what's inside before letting it through | `middleware/validate.js` |
| 🐢 | Turtle | slow, unbothered, catches everything everyone else drops | `middleware/error.js` |
| 🐘 | Elephant | remembers every migration and every DB connection, forever | `db/pool.js`, `db/migrate.js` |
| 🐿️ | Squirrel | buries and digs up your snippets on request | `services/snippets.service.js` |
| 🦡 | Badger | tidies the clipboard burrow every 10 minutes | `jobs/cleanup.js` |
| 🦥 | Sloth | personally slows down anyone hammering `/auth/login` | `routes/auth.routes.js` |
| 🦫 | Beaver | builds and holds a live shared session between your devices | `live-clipboard.js` (frontend, still Supabase-direct) |

(there may or may not be a hidden route that introduces the whole crew properly. 🐾)

---

## Features

- **Snippets** — save, search, tag, pin, and share code snippets with syntax highlighting
- **Online Clipboard** — paste text or upload a file, get a 4-digit code to retrieve it on any device (expires in 24h)
- **Quick Notes** — 4-tab scratchpad with a markdown-style toolbar, fullscreen mode, and download as `.txt`
- **Auth** — sign in / sign up with admin approval flow
- **Admin Panel** — approve/reject users, lock/unlock the site, toggle guest permissions
- **Light / Dark mode** — persisted to localStorage
- **Public sharing** — make any snippet public via a shareable link

---

## File Structure

```
codestash/
│
├── index.html              ← Entry point. Just HTML + <link> and <script> tags.
├── vercel.json             ← Proxies /api/sb-* to Supabase (hides raw URLs from browser)
├── README.md
│
└── src/
    │
    ├── shared/             ← Code used by more than one feature
    │   │
    │   ├── lib/
    │   │   └── supabase.js         ← Supabase URLs + anon keys for both projects.
    │   │                             Change your keys here — one place, affects everything.
    │   │
    │   ├── hooks/
    │   │   └── (theme.js removed)  ← Theme logic lives inside app-core.js
    │   │
    │   ├── ui/
    │   │   └── helpers.js          ← Global utility functions (togglePw, handleLangChange)
    │   │                             called directly from HTML onclick= attributes.
    │   │
    │   └── styles/
    │       ├── tokens.css          ← CSS variables: colors, spacing, transitions.
    │       │                         Dark mode defaults + [data-theme="light"] overrides.
    │       └── global.css          ← Body, layout grid (#appContainer), sidebar, topbar,
    │                                 responsive breakpoints, toast, theme toggle button,
    │                                 syntax highlighting overrides, guest feature cards.
    │
    └── features/           ← One folder per feature. Each owns its styles + logic.
        │
        ├── auth/
        │   ├── auth.css            ← Auth card, pending screen, admin portal styles.
        │   └── app-core.js         ← Everything that shares _session state:
        │                             auth (login/signup/admin), snippets (fetch/save/
        │                             delete/pin/share/tags), admin panel (users/lock),
        │                             navigation (AppUI panel switching), auto-refresh,
        │                             theme toggle listener, rate limiting.
        │
        ├── snippets/
        │   └── snippets.css        ← Snippet cards, tag chips, tag filter bar,
        │                             share modal, public view screen, pinned styles.
        │
        ├── clipboard/
        │   ├── clipboard.css       ← Clipboard upload card, OTP code display, file
        │   │                         drop zone, progress bar, retrieve card, QR code.
        │   └── clipboard.js        ← AppClipboard module (upload text/files, retrieve
        │   |                         by 4-digit code, QR generation) AND AppNotes module
        │   |                         (tabs, toolbar, fullscreen, copy, download, clear).
        │   |                         ⚠ AppNotes is nested INSIDE AppClipboard — do not
        │   |                         separate them or both will break.
        |   |__ live-clipboard.js
        │
        └── notes/
            ├── notes.css           ← Notes panel, tab bar, rename input, toolbar
            │                         buttons, editor textarea, footer actions.
            └── notes.js            ← Empty. AppNotes logic is in clipboard.js.
```

---

## Script Load Order

The order of `<script>` tags in `index.html` matters. Each file depends on the one above it:

```
1. supabase.js      → defines SUPABASE_SNIPPETS_URL / KEY and SUPABASE_CLIPBOARD_URL / KEY
2. helpers.js       → defines togglePw() and handleLangChange() (used by HTML onclick=)
3. app-core.js      → reads supabase.js constants; runs the main app IIFE
4. clipboard.js     → reads supabase.js constants; runs AppClipboard + AppNotes IIFEs
```

## CSS Load Order

```
1. tokens.css       → CSS variables (--bg, --accent, etc.) must come first
2. global.css       → uses those variables for layout
3. auth.css         → uses variables for auth card styles
4. snippets.css     → uses variables for card styles
5. clipboard.css    → uses variables for clipboard styles
6. notes.css        → uses variables for notes styles
```

---

## Two Supabase Projects

CodeStash uses **two separate Supabase projects** intentionally:

| Project | Used for | Key constant |
|---|---|---|
| `<YOUR_SNIPPETS_SUPABASE_PROJECT_ID>` | Snippets, auth, profiles, site settings | `SUPABASE_SNIPPETS_KEY` |
| `<YOUR_CLIPBOARD_SUPABASE_PROJECT_ID>` | Clipboard (ephemeral, no auth needed) | `SUPABASE_CLIPBOARD_KEY` |

Both are proxied through Vercel rewrites in `vercel.json` so the raw Supabase URLs never appear in the browser network tab.

---

## Backend — setup & API

### Setup

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL and JWT_SECRET
npm run migrate              # runs server/db/migrations/*.sql, tracked in a _migrations table
npm run dev                  # nodemon server/server.js — API on http://localhost:4000
```

`DATABASE_URL` can point at a Supabase project's Postgres connection string (Project Settings → Database →
Connection string) or a local/Docker Postgres for development — SSL is enabled automatically unless the host
is `localhost`/`127.0.0.1`. Generate `JWT_SECRET` with `openssl rand -hex 32`.

New users are created with `is_approved = false`; approve them manually until an admin API route exists:
```sql
UPDATE users SET is_approved = true WHERE email = 'someone@example.com';
```

### API

| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/health` | — | liveness check |
| POST | `/auth/register` | — | bcrypt-hashes the password, `is_approved` defaults false |
| POST | `/auth/login` | — | rate-limited (10/15min/IP); returns a 15-minute JWT |
| GET | `/snippets` | — | public feed; `?q=` runs GIN-indexed full-text search, otherwise cursor-paginated (`?cursor=&limit=`) |
| GET | `/snippets/mine` | JWT | cursor-paginated list of the caller's own snippets |
| POST | `/snippets` | JWT | `user_id` comes from the token, never the request body |
| PATCH | `/snippets/:id` | JWT | 403 if the token's user doesn't own the snippet |
| DELETE | `/snippets/:id` | JWT | same ownership check |

All errors share one shape: `{ "error": { "code": "...", "message": "..." } }`.

### Schema

`users` → `snippets` (FK, `ON DELETE CASCADE`) → `clipboard_entries` (independent, OTP-keyed). Indexes: a plain
index on `snippets.user_id`, a composite `(created_at DESC, id DESC)` index backing cursor pagination, a
partial index on `is_public = true`, and a GIN index over a generated `tsvector` column for search. A
`node-cron` job deletes expired `clipboard_entries` every 10 minutes.

---

## Deploying

The old "push to GitHub, Vercel auto-detects a static site" flow only covered the frontend, and no longer
reflects reality now that there's a real Node process to run — a proper deploy target (Docker, a Node host,
etc.) is Phase 5 work in the larger plan, not decided yet.

---

## Changing the Admin Passphrase *(legacy — frontend only, not yet wired to the new backend)*

The frontend still contains its original client-side admin-passphrase flow, unchanged by the new `server/`
API (which has no equivalent route yet — see "Not done yet" in [`LEARNING.md`](./LEARNING.md)). Until the
frontend is rewired, this still describes how that legacy flow works: the admin passphrase is stored as a
SHA-256 hash in `app-core.js` — the real passphrase is never in the code. To change it:

1. Open your browser console and run:
```js
crypto.subtle.digest('SHA-256', new TextEncoder().encode('yourNewPassphrase'))
  .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('')))
```
2. Copy the hash it prints
3. In `app-core.js`, replace the value of `_adminPhraseHash` with your new hash

---
   AppLiveClipboard  —  Real-time shared clipboard + file share
   ─────────────────────────────────────────────────────────────
   SYNC:      WebSocket broadcast (~50ms) + DB poll every 2s
   PRESENCE:  DB heartbeat 10s, TTL 25s
   FILE:      One file per session via Supabase Storage (max 15MB)
              path stored in live_sessions.file_path
              
## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML + CSS + JavaScript (no framework) — still calling Supabase directly, not yet rewired |
| Backend API | Node.js + Express (`server/`) |
| Database | Postgres (raw `pg`, own schema + migrations — Supabase used only as a hosted Postgres, not via its REST/Auth APIs) |
| Auth | Custom JWT + bcrypt (`jsonwebtoken`, `bcryptjs`) |
| Validation | [Zod](https://zod.dev) |
| Scheduled jobs | [node-cron](https://github.com/node-cron/node-cron) |
| Syntax Highlighting | [highlight.js](https://highlightjs.org) |
| QR Codes | [qrcodejs](https://github.com/davidshimjs/qrcodejs) |
| Fonts | DM Sans + DM Mono (Google Fonts) |
| Hosting | [Vercel](https://vercel.com) (frontend, legacy) — backend hosting TBD (Phase 5) |
