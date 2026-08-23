/* 🐢 the turtle — slow, unbothered, and somehow always the one who catches
   everything everyone else drops. nothing gets past without the turtle seeing it. */

export function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  const code = err.code || 'INTERNAL';
  if (status === 500) console.error(err); // if it's a 500, something actually broke — worth a look
  res.status(status).json({ error: { code, message: err.message || 'Server error' } });
}

export function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}
