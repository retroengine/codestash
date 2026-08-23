import pg from 'pg';
import { config } from '../config.js';

/* 🐘 the elephant — holds every connection, forgets nothing, occasionally sits
   on port 5432 next to another elephant who was there first. ask me how I know. */

const isLocal = /localhost|127\.0\.0\.1/.test(config.databaseUrl);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  // Supabase (and most hosted Postgres) requires SSL; local/Docker Postgres usually doesn't have it enabled.
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
});
