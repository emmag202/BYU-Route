const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAccountProxy } = require('../services/lambda-proxy');

test('public dashboard and supported events travel through proxy and Lambda SQL handlers', async () => {
  Object.assign(process.env, { AWS_LAMBDA_FUNCTION_NAME: 'byu-ryde-api', DB_HOST: 'offline', DB_NAME: 'offline', DB_USER: 'offline', DB_PASSWORD: 'offline', DB_SSL_CA: 'package.json' });
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
  app.use(createAccountProxy({ origin: 'https://ryde.example', api: { configured: true, invoke: event => lambda.handler(event, {}) } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const post = type => fetch(base + '/api/events', { method: 'POST', headers: { Origin: 'https://ryde.example', 'Content-Type': 'application/json', 'X-Ryde-Request': '1' }, body: JSON.stringify({ event_type: type }) });
    for (const type of ['trip_planned', 'directions_clicked']) assert.equal((await post(type)).status, 204);
    assert.equal((await post('unsupported')).status, 400);
    for (let i = 0; i < 2; i++) {
      const response = await fetch(base + '/api/okr');
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual((await response.json()).map(r => r.total), ['3', '2', '1', '1']);
    }
    // Lambda also validates types independently of the Render proxy.
    const result = await lambda.handler({ version: '2.0', rawPath: '/api/events', requestContext: { http: { method: 'POST', path: '/api/events' } }, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event_type: 'unsupported' }) }, {});
    assert.equal(result.statusCode, 400); assert.equal(events.length, 2);
    const html = await new Promise((resolve, reject) => lambda.app.render('okr', {}, (err, html) => err ? reject(err) : resolve(html)));
    assert.match(html, /data-metric="account_registrations"/);
  } finally { await new Promise(r => server.close(r)); }
});
