import { pool } from '../db/pool.js';
import { httpError } from '../middleware/error.js';

/* 🐿️ the squirrel — this is the whole point of CodeStash, really. bury an acorn
   (a snippet), remember roughly where you put it, dig it back up months later.
   unlike a real squirrel, this one actually finds its stash again. */

export async function createSnippet(userId, { title, body, language, is_public }) {
  const { rows } = await pool.query(
    `INSERT INTO snippets (user_id, title, body, language, is_public)
     VALUES ($1, $2, $3, $4, COALESCE($5, false))
     RETURNING id, title, language, is_public, created_at, updated_at`,
    [userId, title, body, language || null, is_public ?? null]
  );
  return rows[0];
}

// user_id is never trusted from the request body — identity comes from the verified JWT (req.user.sub).
export async function updateSnippet(id, userId, patch) {
  const { rows } = await pool.query('SELECT user_id FROM snippets WHERE id = $1', [id]);
  if (!rows[0]) throw httpError(404, 'NOT_FOUND', 'Snippet not found');
  if (String(rows[0].user_id) !== String(userId)) throw httpError(403, 'FORBIDDEN', 'Not your snippet');

  const { rows: updated } = await pool.query(
    `UPDATE snippets SET title=$1, body=$2, language=$3, updated_at=now()
     WHERE id=$4 RETURNING id, title, language, is_public, updated_at`,
    [patch.title, patch.body, patch.language || null, id]
  );
  return updated[0];
}

export async function deleteSnippet(id, userId) {
  const { rows } = await pool.query('SELECT user_id FROM snippets WHERE id = $1', [id]);
  if (!rows[0]) throw httpError(404, 'NOT_FOUND', 'Snippet not found');
  if (String(rows[0].user_id) !== String(userId)) throw httpError(403, 'FORBIDDEN', 'Not your snippet');
  await pool.query('DELETE FROM snippets WHERE id = $1', [id]);
}

// Keyset (cursor) pagination over a single user's snippets — an index seek on
// idx_snippets_user_id/idx_snippets_created no matter how deep you page, unlike OFFSET.
// (a squirrel doesn't recount every acorn from the start every time either — it
// remembers the last one it checked and picks up from there.)
export async function listByUser(userId, cursor, limit = 20) {
  if (cursor) {
    const { rows } = await pool.query(
      `SELECT id, title, language, is_public, created_at FROM snippets
       WHERE user_id = $1 AND (created_at, id) < ($2, $3)
       ORDER BY created_at DESC, id DESC
       LIMIT $4`,
      [userId, cursor.createdAt, cursor.id, limit]
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT id, title, language, is_public, created_at FROM snippets
     WHERE user_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

// Same keyset pattern, scoped to public snippets — backs the unauthenticated feed.
export async function listPublic(cursor, limit = 20) {
  if (cursor) {
    const { rows } = await pool.query(
      `SELECT id, title, language, created_at FROM snippets
       WHERE is_public = true AND (created_at, id) < ($1, $2)
       ORDER BY created_at DESC, id DESC
       LIMIT $3`,
      [cursor.createdAt, cursor.id, limit]
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT id, title, language, created_at FROM snippets
     WHERE is_public = true
     ORDER BY created_at DESC, id DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

// GIN-indexed full-text search (idx_snippets_search) instead of an un-indexable LIKE scan.
export async function searchPublic(query, limit = 20) {
  const { rows } = await pool.query(
    `SELECT id, title, language, created_at,
            ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
     FROM snippets
     WHERE is_public = true AND search_vector @@ plainto_tsquery('english', $1)
     ORDER BY rank DESC
     LIMIT $2`,
    [query, limit]
  );
  return rows;
}
