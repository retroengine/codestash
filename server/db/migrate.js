import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, 'migrations');

async function run() {
  // the elephant's memory lives here — every migration that's ever run, forever.
  await pool.query(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY, run_at TIMESTAMPTZ NOT NULL DEFAULT now())`);

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const done = await pool.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
    if (done.rowCount) { console.log('  already know this one:', file); continue; }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log('  learning something new:', file);
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO _migrations(name) VALUES ($1)', [file]);
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  }
  await pool.end();
  console.log('🐘 the elephant remembers everything now. done.');
}

run().catch((e) => { console.error(e); process.exit(1); });
