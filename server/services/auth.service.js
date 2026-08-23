import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { httpError } from '../middleware/error.js';

/* 🦉 the owl again — this is where it actually checks IDs and hands out badges (JWTs). */

export async function register(email, password) {
  const hash = await bcrypt.hash(password, 12); // 12 rounds. deliberately slow on purpose, not a bug
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       RETURNING id, email, role, is_approved`,
      [email.toLowerCase(), hash]
    );
    return rows[0];
  } catch (e) {
    if (e.code === '23505') throw httpError(409, 'EMAIL_TAKEN', 'Email already registered');
    throw e;
  }
}

export async function login(email, password) {
  const { rows } = await pool.query(
    `SELECT id, email, role, is_approved, password_hash FROM users WHERE email = $1`,
    [email.toLowerCase()]
  );
  const user = rows[0];
  // generic message on purpose — don't reveal whether the email exists
  const bad = () => httpError(401, 'BAD_CREDENTIALS', 'Invalid email or password');
  if (!user) { await bcrypt.hash(password, 12); throw bad(); } // hash anyway so a missing email doesn't reply suspiciously fast
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw bad();
  if (!user.is_approved) throw httpError(403, 'NOT_APPROVED', 'Account pending admin approval');

  const token = jwt.sign(
    { sub: String(user.id), role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
  return { token, user: { id: user.id, email: user.email, role: user.role } };
}
