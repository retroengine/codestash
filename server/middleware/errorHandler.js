const { ApiError } = require('../lib/asyncHandler');

function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: 'Not found.', code: 'not_found' } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { message: err.message, code: err.code } });
  }
  console.error(err);
  res.status(500).json({ error: { message: 'Internal server error.', code: 'internal_error' } });
}

module.exports = { notFoundHandler, errorHandler };
