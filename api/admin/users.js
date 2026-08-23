// Admin user list — forwards the caller's own Supabase session token; RLS (admin_read_all)
// does the real authorization.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing authorization token.' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  try {
    const upstream = await fetch(SUPABASE_URL + '/rest/v1/profiles?role=eq.user&order=created_at.asc', {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'Upstream error.' });
  }
}
