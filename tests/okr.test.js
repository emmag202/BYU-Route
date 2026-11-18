const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAccountProxy } = require('../services/lambda-proxy');

test('password-protected dashboard and supported events travel through proxy and Lambda SQL handlers', async () => {
  Object.assign(process.env, { AWS_LAMBDA_FUNCTION_NAME: 'byu-ryde-api', DB_HOST: 'offline', DB_NAME: 'offline', DB_USER: 'offline', DB_PASSWORD: 'offline', DB_SSL_CA: 'package.json' });
  process.env.OKR_ADMIN_PASSWORD = 'offline-test-password';
  const access = require('../services/okr-access');
  const cookie = `${access.COOKIE}=${access.createToken()}`;
  const events = [];
  require('pg').Pool = class {
    on() {}
    async query(sql, args) {
      if (sql === 'SELECT metric, total FROM ryde_demo.okr_dashboard') return { rows: [
        { metric: 'account_registrations', total: '3' }, { metric: 'routes_saved', total: '2' },
        { metric: 'trips_planned', total: String(events.filter(e => e === 'trip_planned').length) },
        { metric: 'directions_clicked', total: String(events.filter(e => e === 'directions_clicked').length) }
      ] };
      assert.equal(sql, 'INSERT INTO ryde_demo.analytics_events (event_type) VALUES ($1)');
      events.push(args[0]); return { rows: [] };
    }
  };
  const lambda = require('../server');
  const app = express(); app.use(express.json());
  app.get('/okr', (req,res,next) => lambda.app(req,res,next));
  app.post('/okr/login', (req,res,next) => lambda.app(req,res,next));
  app.use(createAccountProxy({ origin: 'https://ryde.example', api: { configured: true, invoke: event => lambda.handler(event, {}) } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/okr')).status, 401);
    const locked = await (await fetch(base + '/okr')).text();
    assert.match(locked, /name="password"/); assert.doesNotMatch(locked, /data-metric=/);
    const login = password => fetch(base + '/okr/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password }) });
    assert.equal((await login('wrong')).status, 401);
    const unlocked = await login(process.env.OKR_ADMIN_PASSWORD);
    assert.equal(unlocked.status, 303);
    const issuedCookie = unlocked.headers.get('set-cookie');
    assert.match(issuedCookie, /HttpOnly/); assert.match(issuedCookie, /SameSite=Strict/);
    assert.equal(access.authorized(issuedCookie), true);
    assert.match(await (await fetch(base + '/okr', { headers: { Cookie: issuedCookie.split(';')[0] } })).text(), /data-metric="account_registrations"/);
    const originalPassword = process.env.OKR_ADMIN_PASSWORD;
    delete process.env.OKR_ADMIN_PASSWORD;
    assert.equal(access.authorized(cookie), false);
    process.env.OKR_ADMIN_PASSWORD = originalPassword;
    assert.equal((await fetch(base + '/api/okr', { headers: { Cookie: cookie + 'tampered' } })).status, 401);
    const post = type => fetch(base + '/api/events', { method: 'POST', headers: { Origin: 'https://ryde.example', 'Content-Type': 'application/json', 'X-Ryde-Request': '1' }, body: JSON.stringify({ event_type: type }) });
    for (const type of ['trip_planned', 'directions_clicked']) assert.equal((await post(type)).status, 204);
    assert.equal((await post('unsupported')).status, 400);
    for (let i = 0; i < 2; i++) {
      const response = await fetch(base + '/api/okr', { headers: { Cookie: cookie } });
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual((await response.json()).map(r => r.total), ['3', '2', '1', '1']);
    }
    // Lambda also validates types independently of the Render proxy.
    const result = await lambda.handler({ version: '2.0', rawPath: '/api/events', requestContext: { http: { method: 'POST', path: '/api/events' } }, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event_type: 'unsupported' }) }, {});
    assert.equal(result.statusCode, 400); assert.equal(events.length, 2);
    const html = await new Promise((resolve, reject) => lambda.app.render('okr', {}, (err, html) => err ? reject(err) : resolve(html)));
    assert.match(html, /data-metric="account_registrations"/);
    assert.equal((html.match(/OBJECTIVE [12]/g)||[]).length,2);
    assert.equal((html.match(/data-metric=/g)||[]).length,4);
    for (const label of ['Build Rider Adoption','Help Riders Navigate Campus','Accounts Created','Routes Saved','Trip Routes Viewed','Walking Directions Opened','Google Maps walking directions opened.']) assert.ok(html.includes(label));
    assert.doesNotMatch(html.replace(/<[^>]+>/g,''),/\?|Trips Planned|Directions Clicked/);
    assert.match(html,/BYU RYDE &middot; PROJECT IMPACT/);
    assert.match(html,/Loading counters&hellip;/);
  } finally { await new Promise(r => server.close(r)); }
});
