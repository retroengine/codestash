require('dotenv').config();

const REQUIRED_VARS = [
  'SUPABASE_SNIPPETS_URL',
  'SUPABASE_SNIPPETS_ANON_KEY',
  'SUPABASE_CLIPBOARD_URL',
  'SUPABASE_CLIPBOARD_ANON_KEY',
  'ADMIN_PASSPHRASE_HASH',
];

const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(
    `Missing required environment variable(s): ${missing.join(', ')}. Copy .env.example to .env and fill them in.`
  );
}

module.exports = {
  port: process.env.PORT || 3000,
  snippetsUrl: process.env.SUPABASE_SNIPPETS_URL,
  snippetsAnonKey: process.env.SUPABASE_SNIPPETS_ANON_KEY,
  clipboardUrl: process.env.SUPABASE_CLIPBOARD_URL,
  clipboardAnonKey: process.env.SUPABASE_CLIPBOARD_ANON_KEY,
  adminPassphraseHash: process.env.ADMIN_PASSPHRASE_HASH,
};
