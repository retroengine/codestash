const { ApiError } = require('../lib/asyncHandler');

/** Pulls the bearer token off the request, if any. Does not itself verify it —
 *  verification happens naturally when the token is forwarded to Supabase, which
 *  will reject bad/expired tokens on the underlying call (same trust model the
 *  browser used when it called Supabase directly). */
function attachAccessToken(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  req.accessToken = scheme === 'Bearer' && token ? token : null;
  next();
}

/** Requires attachAccessToken to have found a token. */
function requireAuth(req, _res, next) {
  if (!req.accessToken) return next(new ApiError(401, 'unauthorized', 'Sign in required.'));
  next();
}

module.exports = { attachAccessToken, requireAuth };
