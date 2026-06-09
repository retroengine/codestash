# CodeStash

A personal code snippet library with an online clipboard and quick notes — built with vanilla HTML, CSS, and JavaScript, backed by Supabase and deployed on Vercel.

**Live site:** https://<YOUR_DEPLOYMENT_URL>.vercel.app

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

## Deploying

1. Push to GitHub
2. Import the repo on [vercel.com](https://vercel.com)
3. Vercel auto-detects it as a static site — no build settings needed
4. Every `git push` to `main` triggers an automatic redeploy

---

## Changing the Admin Passphrase

The admin passphrase is stored as a SHA-256 hash in `app-core.js` — the real passphrase is never in the code. To change it:

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
| Frontend | Vanilla HTML + CSS + JavaScript (no framework) |
| Auth + Database | [Supabase](https://supabase.com) (Postgres + Auth) |
| Syntax Highlighting | [highlight.js](https://highlightjs.org) |
| QR Codes | [qrcodejs](https://github.com/davidshimjs/qrcodejs) |
| Fonts | DM Sans + DM Mono (Google Fonts) |
| Hosting | [Vercel](https://vercel.com) |
