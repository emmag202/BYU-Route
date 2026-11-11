const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Render -> signed Invoke -> Lambda: accounts, refresh persistence, ownership and logout', async () => {
  Object.assign(process.env, {
    AWS_LAMBDA_FUNCTION_NAME: 'byu-ryde-api', NODE_ENV: 'production',
    DB_HOST: 'offline', DB_NAME: 'offline', DB_USER: 'offline', DB_PASSWORD: 'offline',
    DB_SSL_CA: 'package.json', RYDE_LAMBDA_FUNCTION_ARN: '', DEMO_SETUP_ENABLED: 'false',
  });
  const users = [], sessions = new Map(), favorites = new Map(), homes = new Map();
  let pools = 0, invocations = 0, setupSql, migrationCalls = 0;
  require('pg').Pool = class {
    constructor(config) {
      pools++;
      assert.equal(config.ssl.rejectUnauthorized, true);
      assert.equal(config.max, 2);
    }
    on() {}
    async end() {}
    async connect() {
      return { query: async sql => { setupSql = sql; }, release() {} };
    }
    async query(sql, args = []) {
      if (sql.startsWith('DO $$')) {
        migrationCalls++;
        assert.match(sql, /conrelid = 'ryde_demo.appuser'::regclass/);
        assert.match(sql, /conname = 'appuser_email_check' AND contype = 'c'/);
        assert.match(sql, /pg_get_expr\(conbin, conrelid\)/);
        assert.match(sql, /RAISE EXCEPTION/);
        assert.match(sql, /DROP CONSTRAINT IF EXISTS appuser_email_check/);
        assert.doesNotMatch(sql, /DROP TABLE|CASCADE|DELETE FROM|TRUNCATE|ADD CONSTRAINT/);
        return { rows: [] };
      }
      assert.match(sql, /ryde_demo\./);
      assert.doesNotMatch(sql, /public\./);
      if (sql.startsWith('INSERT INTO ryde_demo.appuser')) {
        if (users.some(u => u.net_id === args[1])) return { rows: [] };
        if (users.some(u => u.email === args[2])) throw Object.assign(Error('duplicate email'), { code: '23505' });
        const user = { user_id: users.length + 1, name: args[0], net_id: args[1], email: args[2], password_hash: args[3] };
        users.push(user);
        const { password_hash, ...safeUser } = user;
        return { rows: [safeUser] };
      }
      if (sql.startsWith('DELETE FROM ryde_demo.appsession')) {
        if (args.length) sessions.delete(args[0]);
        return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO ryde_demo.appsession')) {
        sessions.set(args[1], args[0]);
        return { rows: [] };
      }
      if (sql.includes('FROM ryde_demo.appsession')) {
        return { rows: sessions.has(args[0]) ? [{ user_id: sessions.get(args[0]) }] : [] };
      }
      if (sql.includes('FROM ryde_demo.appuser')) {
        if (sql.includes('LIMIT 0')) return { rows: [] };
        const user = sql.includes('WHERE net_id') ? users.find(u => u.net_id === args[0]) : users.find(u => u.user_id === args[0]);
        if (!user) return { rows: [] };
        const { password_hash, ...safeUser } = user;
        return { rows: [sql.includes('password_hash') ? { ...user } : safeUser] };
      }
      if (sql.startsWith('INSERT INTO ryde_demo.favoriteroute')) {
        favorites.set(args[0], args[1]); return { rows: [] };
      }
      if (sql.startsWith('DELETE FROM ryde_demo.favoriteroute')) {
        favorites.delete(args[0]); return { rows: [] };
      }
      if (sql.includes('FROM ryde_demo.favoriteroute')) {
        return { rows: favorites.has(args[0]) ? [{ route_name: favorites.get(args[0]) }] : [] };
      }
      if (sql.startsWith('INSERT INTO ryde_demo.user_home')) {
        const home = { label: args[1], lat: args[2], lng: args[3] };
        homes.set(args[0], home); return { rows: [home] };
      }
      if (sql.startsWith('DELETE FROM ryde_demo.user_home')) {
        homes.delete(args[0]); return { rows: [] };
      }
      if (sql.includes('FROM ryde_demo.user_home')) return { rows: homes.has(args[0]) ? [homes.get(args[0])] : [] };
      if (sql.includes('FROM ryde_demo.route') && sql.includes('LIMIT 0')) return { rows: [] };
      throw Error('Unhandled test query');
    }
  };
  const lambda = require('../server');
  delete require.cache[require.resolve('../server')];
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  Object.assign(process.env, {
    RENDER: 'true', AWS_REGION: 'us-east-1', APP_ORIGIN: 'https://ryde.example',
    RYDE_LAMBDA_FUNCTION_ARN: 'arn:aws:lambda:us-east-1:123456789012:function:byu-ryde-api',
  });
  require('@aws-sdk/client-lambda').LambdaClient.prototype.send = async command => {
    invocations++;
    assert.equal(command.input.FunctionName, process.env.RYDE_LAMBDA_FUNCTION_ARN);
    const result = await lambda.handler(JSON.parse(command.input.Payload.toString()), {});
    return { StatusCode: 200, Payload: Buffer.from(JSON.stringify(result)) };
  };
  // Rate limiting is exercised separately; this scenario intentionally makes many requests.
  const transport = require('../services/lambda-proxy');
  const originalProxy = transport.createAccountProxy;
  transport.createAccountProxy = options => originalProxy({ ...options, rateLimit: () => true });
  const { app } = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  {
    const base = 'http://127.0.0.1:' + server.address().port;
    async function call(method, path, body, cookie) {
      return fetch(base + path, {
        method, headers: { 'Content-Type': 'application/json', Origin: process.env.APP_ORIGIN,
          'X-Ryde-Request': '1', ...(cookie ? { Cookie: cookie } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    }
    const signup = (name, email = name + '@example.test') => call('POST', '/api/users', {
      name, net_id: name, email, password: 'demo-test-password',
    });
    try {
      await assert.rejects(lambda.setup({ action: 'install-demo-schema' }), /disabled/);
      await assert.rejects(lambda.setup({ action: 'remove-demo-email-constraint' }), /disabled/);
      process.env.DEMO_SETUP_ENABLED = 'true';
      assert.deepEqual(await lambda.setup({ action: 'install-demo-schema' }), { ok: true, schema: 'ryde_demo' });
      assert.match(setupSql, /CREATE SCHEMA IF NOT EXISTS ryde_demo/);
      assert.match(setupSql, /BEGIN;/); assert.match(setupSql, /COMMIT;/);
      assert.doesNotMatch(setupSql, /ALTER TABLE public/);
      assert.equal((await lambda.setup({ action: 'check-demo-database' })).database, 'connected');
      assert.match(setupSql, /email VARCHAR\(100\) NOT NULL UNIQUE,/);
      assert.doesNotMatch(setupSql, /@example\.test/);
      for (let i = 0; i < 2; i++) {
        assert.deepEqual(await lambda.setup({ action: 'remove-demo-email-constraint' }), { ok: true, schema: 'ryde_demo' });
      }
      assert.equal(migrationCalls, 2);
      await assert.rejects(lambda.setup({ action: 'arbitrary-sql' }), /Unknown/);
      process.env.DEMO_SETUP_ENABLED = 'false';
      assert.equal(pools, 1, 'Render must not construct a database pool even with DB env values');
      assert.equal((await call('GET', '/api/me')).status, 401);
      const first = await signup('demo-one');
      assert.equal(first.status, 200);
      const cookie = first.headers.get('set-cookie').split(';')[0];
      for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api']) assert.ok(first.headers.get('set-cookie').includes(flag));
      assert.equal((await first.json()).user.password_hash, undefined);
      assert.match(users[0].password_hash, /^scrypt/);
      assert.equal((await signup('demo-one')).status, 409);
      assert.equal((await call('POST', '/api/login', { net_id: 'demo-one', password: 'wrong' })).status, 401);
      assert.equal((await call('POST', '/api/login', { net_id: 'missing', password: 'wrong' })).status, 401);
      assert.equal((await call('POST', '/api/users/1/favorites', { route_key: '101' }, cookie)).status, 204);
      assert.equal((await call('PUT', '/api/users/1/home', { label: 'Campus demo', lat: 40, lng: -111 }, cookie)).status, 200);
      // Fresh requests with the session cookie model browser refresh: state comes from database queries.
      assert.equal((await (await call('GET', '/api/me', null, cookie)).json()).user_id, 1);
      assert.deepEqual(await (await call('GET', '/api/users/1/favorites', null, cookie)).json(), ['101']);
      assert.equal((await (await call('GET', '/api/users/1/home', null, cookie)).json()).label, 'Campus demo');
      const second = await signup('demo-two');
      const secondCookie = second.headers.get('set-cookie').split(';')[0];
      assert.deepEqual(await (await call('GET', '/api/users/2/favorites', null, secondCookie)).json(), []);
      for (const [method, path, body] of [
        ['GET', '/api/users/1/favorites'], ['POST', '/api/users/1/favorites', { route_key: '102' }],
        ['DELETE', '/api/users/1/favorites/101'], ['GET', '/api/users/1/home'],
        ['PUT', '/api/users/1/home', { label: 'Other', lat: 0, lng: 0 }], ['DELETE', '/api/users/1/home'],
      ]) assert.equal((await call(method, path, body, secondCookie)).status, 403);
      assert.equal((await call('DELETE', '/api/users/1/favorites/101', null, cookie)).status, 204);
      assert.deepEqual(await (await call('GET', '/api/users/1/favorites', null, cookie)).json(), []);
      assert.equal((await call('DELETE', '/api/users/1/home', null, cookie)).status, 204);
      assert.equal((await call('GET', '/api/users/1/home', null, cookie)).status, 200);
      assert.equal((await call('POST', '/api/logout', null, cookie)).status, 204);
      assert.equal((await call('GET', '/api/me', null, cookie)).status, 401);
      const login = await call('POST', '/api/login', { net_id: 'demo-one', password: 'demo-test-password' });
      assert.equal(login.status, 200);
      for (const [i, email] of ['Rider+tag@GMAIL.com', 'rider@byu.edu', 'rider@outlook.com', 'rider@custom.example', 'rider@sub.custom.example'].entries()) {
        const result = await signup('provider-' + i, email);
        assert.equal(result.status, 200, email);
        assert.equal((await result.json()).user.email, email.toLowerCase());
      }
      assert.equal((await signup('duplicate-email', 'RIDER@BYU.EDU')).status, 409);
      for (const email of ['missing-at', '@gmail.com', 'rider@', 'two@@gmail.com', 'has space@gmail.com', 'rider@-invalid.com', 'rider@domain..com']) {
        const before = invocations;
        assert.equal((await signup('invalid-email', email)).status, 400, email);
        assert.equal(invocations, before, 'Render rejects malformed email before Invoke');
        const direct = await lambda.handler({
          version: '2.0', rawPath: '/api/users', headers: { 'content-type': 'application/json' },
          requestContext: { http: { method: 'POST', path: '/api/users', sourceIp: '127.0.0.1' } },
          body: JSON.stringify({ name: 'Invalid', net_id: 'invalid', email, password: 'test-password' }),
        }, {});
        assert.equal(direct.statusCode, 400, 'Lambda independently rejects ' + email);
      }
      assert.ok(invocations > 10);
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});
