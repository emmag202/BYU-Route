const crypto = require('node:crypto');
const COOKIE = 'ryde_okr';
const HOURS = 12;
function equal(a, b) {
  const hash = value => crypto.createHash('sha256').update(String(value)).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}
function signature(expiry) {
  return crypto.createHmac('sha256', process.env.OKR_ADMIN_PASSWORD).update('ryde-okr:' + expiry).digest('hex');
}
function createToken() {
  const expiry = String(Date.now() + HOURS * 3600000);
  return expiry + '.' + signature(expiry);
}
function readToken(cookie = '') {
  return cookie.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
}
function authorized(cookie) {
  if (!process.env.OKR_ADMIN_PASSWORD) return false;
  const token = readToken(cookie);
  if (!/^\d{13}\.[a-f0-9]{64}$/.test(token)) return false;
  const [expiry, sig] = token.split('.');
  return Number(expiry) > Date.now() && Number(expiry) <= Date.now() + HOURS * 3600000 && equal(sig, signature(expiry));
}
function requireOkr(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (!authorized(req.get('cookie'))) return res.status(401).json({ error: 'Enter the team password at /okr.' });
  next();
}
module.exports = { COOKIE, HOURS, equal, createToken, readToken, authorized, requireOkr };
