// Admin sign-in — verifies the passphrase server-side (never shipped to the client),
// then authenticates against Supabase and confirms the profile has role='admin'.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, password, passphrase } = req.body || {};
  if (!email || !password || !passphrase) {
    return res.status(400).json({ error: 'Missing email, password, or passphrase.' });
  }
  if (passphrase !== process.env.ADMIN_PASSPHRASE) {
    return res.status(401).json({ error: 'Invalid admin passphrase.' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  try {
    const authRes = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const session = await authRes.json();
    if (!authRes.ok) {
      return res.status(401).json({ error: session.error_description || session.msg || 'Authentication failed.' });
    }

    const profileRes = await fetch(
      SUPABASE_URL + '/rest/v1/profiles?id=eq.' + encodeURIComponent(session.user.id) + '&limit=1',
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + session.access_token } }
    );
    const rows = await profileRes.json();
    const profile = Array.isArray(rows) ? rows[0] : null;

    if (!profile || profile.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. This account does not have admin privileges.' });
    }

    return res.status(200).json({ session, profile });
  } catch (err) {
    return res.status(502).json({ error: 'Upstream authentication error.' });
  }
}
