const { SupabaseClient } = require('./postgrest');
const env = require('../config/env');

const snippetsClient = new SupabaseClient({ url: env.snippetsUrl, anonKey: env.snippetsAnonKey });
const clipboardClient = new SupabaseClient({ url: env.clipboardUrl, anonKey: env.clipboardAnonKey });

module.exports = { snippetsClient, clipboardClient };
