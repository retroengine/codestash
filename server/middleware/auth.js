import jwt from 'jsonwebtoken';
import { config } from '../config.js';

/* 🦉 the owl — sits at the door all night, checks everyone's badge, never sleeps.
   doesn't care WHO you are, just whether your token is real. */

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) { const e = new Error('Authentication required'); e.status = 401; e.code = 'NO_TOKEN'; return next(e); }
  try {
    req.user = jwt.verify(token, config.jwtSecret); // { sub, role, iat, exp }
    next();
  } catch {
    const e = new Error('Invalid or expired token'); e.status = 401; e.code = 'BAD_TOKEN'; next(e);
  }
}

export function requireAdmin(req, _res, next) {
  // the owl checks two things now: got a badge, AND the badge says "admin". picky bird.
  if (req.user?.role !== 'admin') { const e = new Error('Admin only'); e.status = 403; e.code = 'FORBIDDEN'; return next(e); }
  next();
}
