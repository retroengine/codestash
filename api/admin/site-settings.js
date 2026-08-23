// Admin site-settings: read/toggle site lock + guest feature flags.
// Forwards the caller's own Supabase session token — RLS (admin_update_settings)
// does the real authorization, this route doesn't duplicate that logic.
export default async function handler(req, res) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing authorization token.' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  try {
    if (req.method === 'GET') {
      const upstream = await fetch(
        SUPABASE_URL + '/rest/v1/site_settings?id=eq.1&select=locked,guest_notes,guest_add_snippet',
        { headers }
      );
      const data = await upstream.json();
      return res.status(upstream.status).json(data);
    }

    if (req.method === 'PATCH') {
      const upstream = await fetch(SUPABASE_URL + '/rest/v1/site_settings?id=eq.1', {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(req.body || {})
      });
      const data = upstream.status === 204 ? [] : await upstream.json();
      return res.status(upstream.status).json(data);
    }

    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(502).json({ error: 'Upstream error.' });
  }
}
