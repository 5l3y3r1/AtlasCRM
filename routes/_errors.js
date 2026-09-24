// One place to turn a thrown error into an HTTP response.
//
// Routes used to end every catch with `res.status(500).json({ error: e.message })`,
// which handed the browser raw SQLite text. "NOT NULL constraint failed:
// listings.title" names a table and a column to anyone poking at the API, and
// tells an agent staring at a toast nothing at all. Stack traces reach the
// server log; the caller gets something it can act on.

const IS_PROD = process.env.NODE_ENV === 'production';

// Constraint failures describe what the CALLER sent, so they can be rephrased
// and returned honestly. Anything else is treated as our problem, not theirs.
function describe(e) {
  const msg = String((e && e.message) || '');

  let m = msg.match(/UNIQUE constraint failed: ([\w.,\s]+)/);
  if (m) {
    const field = m[1].split(',')[0].trim().split('.').pop().replace(/_/g, ' ');
    return { status: 409, error: `A record with this ${field} already exists.`, code: 'duplicate' };
  }

  m = msg.match(/NOT NULL constraint failed: [\w]+\.([\w]+)/);
  if (m) {
    return { status: 400, error: `Missing required field: ${m[1]}`, code: 'missing_field', field: m[1] };
  }

  if (/FOREIGN KEY constraint failed/.test(msg)) {
    return { status: 400, error: 'Linked record does not exist or is still in use.', code: 'bad_reference' };
  }
  if (/CHECK constraint failed/.test(msg)) {
    return { status: 400, error: 'One of the values is not allowed.', code: 'invalid_value' };
  }
  if (/datatype mismatch|no such column: |incomplete input|syntax error/.test(msg)) {
    return { status: 400, error: 'The request could not be understood.', code: 'bad_request' };
  }
  return null;
}

// Third-party clients build URLs with the tenant's own access token in the
// query string. A network-level failure can echo that URL back, so anything
// travelling outward gets scrubbed first.
function redactSecrets(text) {
  return String(text == null ? '' : text)
    .replace(/(access_token|api_key|apikey|token|password|secret)=([^&\s"']+)/gi, '$1=***')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, 'Bearer ***')
    .replace(/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+/g, '***');
}

// fail(res, e, { status, message, context })
//   status  — what to answer when the error isn't a recognised constraint (default 500)
//   message — what to say in production for that case
//   context — log prefix, e.g. 'listings.create'
function fail(res, e, opts = {}) {
  const { status = 500, message = 'Something went wrong. Please try again.', context = 'error' } = opts;
  console.error(`[${context}]`, (e && e.stack) || e);

  const known = describe(e);
  if (known) {
    const { status: code, ...body } = known;
    return res.status(code).json(body);
  }

  // Outside production the real message is worth far more than the hygiene.
  return res.status(status).json({
    error: redactSecrets(IS_PROD ? message : String((e && e.message) || message)),
  });
}

// For places that collect error strings into a list rather than answering.
function safeMessage(e, fallback = 'Something went wrong.') {
  const known = describe(e);
  if (known) return known.error;
  return redactSecrets(IS_PROD ? fallback : String((e && e.message) || fallback));
}

module.exports = { fail, safeMessage, describe, redactSecrets };
