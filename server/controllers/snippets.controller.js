import * as svc from '../services/snippets.service.js';

function decodeCursor(raw) {
  if (!raw) return null;
  try { return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); }
  catch { const e = new Error('Invalid cursor'); e.status = 400; e.code = 'VALIDATION'; throw e; }
}

function encodeCursor(rows) {
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  return Buffer.from(JSON.stringify({ createdAt: last.created_at, id: last.id })).toString('base64url');
}

// GET /snippets — public feed. ?q= triggers full-text search, otherwise cursor pagination.
export const list = async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    if (req.query.q) return res.json({ items: await svc.searchPublic(req.query.q, limit) });
    const rows = await svc.listPublic(decodeCursor(req.query.cursor), limit);
    res.json({ items: rows, nextCursor: encodeCursor(rows) });
  } catch (e) { next(e); }
};

// GET /snippets/mine — cursor-paginated list of the signed-in user's own snippets.
export const mine = async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const rows = await svc.listByUser(req.user.sub, decodeCursor(req.query.cursor), limit);
    res.json({ items: rows, nextCursor: encodeCursor(rows) });
  } catch (e) { next(e); }
};

export const create = async (req, res, next) => {
  try { res.status(201).json(await svc.createSnippet(req.user.sub, req.body)); }
  catch (e) { next(e); }
};

export const update = async (req, res, next) => {
  try { res.json(await svc.updateSnippet(req.params.id, req.user.sub, req.body)); }
  catch (e) { next(e); }
};

export const remove = async (req, res, next) => {
  try { await svc.deleteSnippet(req.params.id, req.user.sub); res.status(204).end(); }
  catch (e) { next(e); }
};
