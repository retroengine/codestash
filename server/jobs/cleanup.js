import cron from 'node-cron';
import { pool } from '../db/pool.js';

/* 🦡 the badger — every 10 minutes it goes through the burrow (clipboard_entries)
   and tosses out anything that's gone stale. thankless job, does it anyway. */

export function startCleanupJob() {
  cron.schedule('*/10 * * * *', async () => {
    const r = await pool.query('DELETE FROM clipboard_entries WHERE expires_at < now()');
    if (r.rowCount) console.log(`🦡 badger tidied up ${r.rowCount} expired clipboard entr${r.rowCount === 1 ? 'y' : 'ies'}`);
  });
}
