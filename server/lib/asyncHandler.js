/** Wraps an async route handler so a rejected promise reaches the error middleware. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Error carrying an HTTP status + machine-readable code, for the central error handler. */
class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

module.exports = { asyncHandler, ApiError };
