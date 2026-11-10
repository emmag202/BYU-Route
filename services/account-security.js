// Shared session parsing and browser request protections; these do not verify a student's identity.
const COOKIE = 'ryde_session';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function sessionCookieOptions(production = process.env.NODE_ENV === 'production') {
  return { httpOnly: true, secure: production, sameSite: 'strict', path: '/api' };
}

function readSession(cookie = '') {
  const values = cookie.split(';').map(s => s.trim()).filter(s => s.startsWith(`${COOKIE}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(COOKIE.length + 1);
  return TOKEN.test(value) ? value : null;
}

function csrfAllowed(req, origin) {
  if (['GET', 'HEAD'].includes(req.method)) return true;
  // JSON + a custom header forces a CORS preflight; exact Origin validation denies foreign callers.
  // No credentialed CORS is enabled for the account proxy.
  return Boolean(origin) && req.get('origin') === origin && req.get('x-ryde-request') === '1' &&
    req.get('sec-fetch-site') !== 'cross-site' &&
    req.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json';
}

function createRateLimit({ limit = 20, windowMs = 60000, maxKeys = 10000, now = Date.now } = {}) {
  const entries = new Map();
  return function allowed(key) {
    const time = now();
    for (const [id, value] of entries) if (value.reset <= time) entries.delete(id);
    let entry = entries.get(key);
    if (!entry) {
      if (entries.size >= maxKeys) return false;
      entry = { count: 0, reset: time + windowMs };
      entries.set(key, entry);
    }
    return ++entry.count <= limit;
  };
}

module.exports = { COOKIE, TOKEN, sessionCookieOptions, readSession, csrfAllowed, createRateLimit };
