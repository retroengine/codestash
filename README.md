# CodeStash

A personal code snippet manager you can access from anywhere via a browser. No login, no app, just a single HTML file connected to a database.

## What it does

- Save code snippets with a name and language tag
- One-click copy to clipboard
- Search snippets by name or language
- Delete snippets you no longer need
- Works from any device — lab, home, phone

## Stack

- **Frontend** — Plain HTML + CSS + vanilla JS (no framework, no build step)
- **Database** — Supabase (free tier)
- **Hosting** — Vercel (free tier, gives you a permanent public URL)

## Setup

### 1. Supabase (database)

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run:

```sql
create table snippets (
  id uuid default gen_random_uuid() primary key,
  name text,
  language text,
  code text,
  created_at timestamptz default now()
);

alter table snippets disable row level security;
```

3. Go to **Settings → API** and copy your **Project URL** and **anon/public key**
4. Paste them into `index.html` at the top of the `<script>` tag:

```js
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_KEY = 'your-anon-key';
```

### 2. Vercel (hosting)

1. Upload `index.html` to a GitHub repo (rename it to `index.html`)
2. Go to [vercel.com](https://vercel.com) → Import that repo
3. Set Framework to **Other**, Output Directory to **`.`**, leave Build Command blank
4. Deploy — you get a permanent URL like `https://codestash.vercel.app`

## Updating later

Edit `index.html` directly on GitHub. Vercel auto-deploys within seconds.

## Notes

- Your anon key is visible in the HTML source — this is fine for a personal tool since only you know the URL
- The table has RLS disabled, meaning anyone with your URL and key can read/write — acceptable for private personal use
