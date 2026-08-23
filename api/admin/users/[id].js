// Admin user status update (approve/reject/revoke) — forwards the caller's own Supabase
// session token; RLS (admin_update) does the real authorization.
module.exports = async (req, res) => {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing authorization token.' });

  const userId = req.query.id;
  if (!userId) return res.status(400).json({ error: 'Missing user id.' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  try {
    const upstream = await fetch(SUPABASE_URL + '/rest/v1/profiles?id=eq.' + encodeURIComponent(userId), {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(req.body || {})
    });
    const data = upstream.status === 204 ? [] : await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'Upstream error.' });
  }
};
