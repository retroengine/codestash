# Learning log — Phase 2 & 3 build

One sentence per step: what got built, and one thing that was surprising.

## Bootstrap
- Built the Express skeleton (`app.js`/`server.js`/`config.js`) plus a transactional, numbered SQL migration
  runner (`db/migrate.js`) that tracks what's already run in a `_migrations` table.
- Surprise: `pg.Pool` doesn't actually connect on creation — the server can boot and answer `/health` even with
  a completely wrong `DATABASE_URL`; the failure only shows up on the first real query.

## Phase 2 — Auth
- Added `users` (bcrypt `password_hash`, `role`, `is_approved`), a register/login service, JWT issuance, and
  `requireAuth`/`requireAdmin` middleware.
- Surprise: local Windows already had a native Postgres listening on 5432, which silently intercepted the
  Docker container's connections with a *different* password — `password authentication failed` looked like a
  bcrypt/config bug at first but was actually a port collision. Moved the dev container to 55432 to fix it.
- Surprise: the constant-time-ish login path (hashing a dummy password when the email doesn't exist) means a
  failed login for a nonexistent user takes about as long as one for a real user with a wrong password —
  verified by comparing response times for both, not just by reading the code.

## Phase 3 — Database depth
- Added `snippets` with a `user_id` FK (`ON DELETE CASCADE`) and a `CHECK` constraint on title length, three
  indexes (plain, composite for pagination, partial for `is_public`), a generated `tsvector` column with a GIN
  index for search, and keyset (cursor) pagination instead of `OFFSET`.
- Surprise: `EXPLAIN ANALYZE` on the FTS query showed a **Seq Scan**, not the expected Index Scan, right after
  creating the index — the table only had 4 rows, and Postgres correctly judged a sequential scan cheaper than
  the index's overhead at that size. The GIN index (`idx_snippets_search`) only shows up as a **Bitmap Index
  Scan** once the table has enough rows (confirmed at 100k+) for the planner to prefer it — a good reminder
  that "the index isn't used" and "the index isn't *worth* using yet" look identical in an EXPLAIN plan.
- Verified ownership authorization end-to-end with curl: a second user's token gets `403 FORBIDDEN` trying to
  PATCH the first user's snippet; no token gets `401`; a nonexistent id gets `404`.
- Verified the clipboard cleanup job's query directly: `DELETE FROM clipboard_entries WHERE expires_at < now()`
  removed only the manually-inserted expired row and left the still-valid one in place.

## Not done yet (explicitly deferred)
- The frontend (`app-core.js`, `clipboard.js`) still talks to Supabase directly — it has not been rewired to
  call this new `/auth` and `/snippets` API. That's the "Frontend change (small, do it after)" step from the
  guide and is the next piece of work, not something silently skipped.
- No load-test numbers recorded yet (`hey`/`k6` before/after the FTS index) — that's real Phase 4 work
  (rate limiting + caching + benchmarks) from the original 5-phase plan, not manufactured here.
- Admin approval today is a manual `UPDATE users SET is_approved = true` in SQL — there's no admin API route
  yet (the original app's separate "admin passphrase" screen has no equivalent in this schema; `role='admin'`
  plus `requireAdmin` exists in middleware but isn't wired to any route).
