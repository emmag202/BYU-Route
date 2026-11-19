const crypto = require('node:crypto');
const COOKIE = 'ryde_okr';
const HOURS = 12;
function equal(a,b) { const h = v => crypto.createHash('sha256').update(String(v)).digest(); return crypto.timingSafeEqual(h(a),h(b)); }
function sign(value) { return crypto.createHmac('sha256', process.env.OKR_ADMIN_PASSWORD).update('ryde-okr-v2:' + value).digest('hex'); }
function createToken() { const value = `${Date.now() + HOURS * 3600000}.${crypto.randomBytes(24).toString('hex')}`; return `${value}.${sign(value)}`; }
function readToken(cookie = '') { const values = cookie.split(';').map(s => s.trim()).filter(s => s.startsWith(COOKIE + '=')); return values.length === 1 ? values[0].slice(COOKIE.length + 1) : ''; }
function authorized(cookie) { if (!process.env.OKR_ADMIN_PASSWORD) return false; const token = readToken(cookie); if (!/^\d{13}\.[a-f0-9]{48}\.[a-f0-9]{64}$/.test(token)) return false; const [expiry,nonce,sig] = token.split('.'); return Number(expiry) > Date.now() && Number(expiry) <= Date.now() + HOURS * 3600000 && equal(sig,sign(`${expiry}.${nonce}`)); }
function proof(token) { return crypto.createHmac('sha256', process.env.OKR_ADMIN_PASSWORD).update('ryde-admin-create:' + token).digest('hex'); }
function hash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function requireOkr(req,res,next) { res.set('Cache-Control','no-store'); if (!authorized(req.get('cookie'))) return res.status(401).json({error:'Please sign in at /okr.'}); next(); }
module.exports = { COOKIE,HOURS,equal,createToken,readToken,authorized,requireOkr,proof,hash };
