// Offline verification of the actual Lambda package. No AWS or RDS requests are made.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { X509Certificate } = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(process.argv[2] || '.');
const load = createRequire(path.join(root, 'server.js'));
const pem = fs.readFileSync(path.join(root, 'global-bundle.pem'), 'utf8');
assert.doesNotMatch(pem, /PRIVATE KEY/);
const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
assert.ok(certificates.length, 'Missing RDS CA certificates');
for (const text of certificates) {
  const cert = new X509Certificate(text);
  assert.ok(cert.ca && Date.parse(cert.validFrom) <= Date.now() && Date.parse(cert.validTo) > Date.now(), 'Invalid RDS CA');
}
const lock = load('./package-lock.json');
for (const [relative, info] of Object.entries(lock.packages)) {
  if (!relative || info.dev || info.optional) continue;
  assert.equal(load(path.join(root, relative, 'package.json')).version, info.version, relative);
}
if (process.argv.includes('--validate-only')) {
  console.log('Validated RDS CA bundle and locked runtime dependencies.');
  process.exit(0);
}
Object.assign(process.env, {
  AWS_LAMBDA_FUNCTION_NAME: 'byu-ryde-api', AWS_REGION: 'us-east-1', NODE_ENV: 'production',
  DB_HOST: 'offline.invalid', DB_PORT: '5432', DB_NAME: 'offline', DB_USER: 'offline',
  DB_PASSWORD: 'offline-test-only', DB_SSL_CA: path.join(root, 'global-bundle.pem'),
  RYDE_LAMBDA_FUNCTION_ARN: '', DEMO_SETUP_ENABLED: 'false',
});
let queries = 0, invokes = 0, pools = 0;
load('pg').Pool = class {
  constructor(config) {
    pools++;
    assert.equal(config.host, process.env.DB_HOST);
    assert.equal(config.port, 5432);
    assert.equal(config.database, process.env.DB_NAME);
    assert.equal(config.user, process.env.DB_USER);
    assert.equal(config.password, process.env.DB_PASSWORD);
    assert.equal(config.ssl.rejectUnauthorized, true);
    assert.equal(config.ssl.ca, pem);
  }
  on() {}
  async query() { queries++; return { rows: [] }; }
  async end() {}
};
load('@aws-sdk/client-lambda').LambdaClient.prototype.send = async () => {
  invokes++; throw new Error('AWS access forbidden in offline smoke test');
};
const { handler, setup } = load('./server.js');
async function invoke(method, url, body) {
  return handler({
    version: '2.0', routeKey: '$default', rawPath: url, rawQueryString: '',
    headers: { host: 'offline.invalid', 'content-type': 'application/json' },
    requestContext: { http: { method, path: url, sourceIp: '127.0.0.1', protocol: 'HTTP/1.1' } },
    ...(body ? { body: JSON.stringify(body) } : {}), isBase64Encoded: false,
  }, {});
}
(async () => {
  const health = await invoke('GET', '/api/health');
  assert.equal(health.statusCode, 200);
  assert.equal(JSON.parse(health.body).database, 'configured-unverified');
  for (const [method, url] of [
    ['POST', '/api/logout'], ['GET', '/api/me'],
    ['GET', '/api/users/1/favorites'], ['POST', '/api/users/1/favorites'], ['DELETE', '/api/users/1/favorites/101'],
    ['GET', '/api/users/1/home'], ['PUT', '/api/users/1/home'], ['DELETE', '/api/users/1/home'],
  ]) assert.equal((await invoke(method, url)).statusCode, 401, method + ' ' + url);
  assert.equal((await invoke('POST', '/api/login', { net_id: 'missing', password: 'wrong' })).statusCode, 401);
  assert.equal((await invoke('POST', '/api/users', { name: 'Incomplete' })).statusCode, 400);
  await assert.rejects(setup({ action: 'install-demo-schema' }), /disabled/);
  assert.ok(fs.readFileSync(path.join(root, 'services/demo-schema.sql'), 'utf8').includes('CREATE SCHEMA IF NOT EXISTS ryde_demo'));
  const home = await invoke('GET', '/');
  assert.equal(home.statusCode, 200); assert.match(home.body, /id="app"/);
  for (const asset of ['/js/app.js', '/js/route-map.js', '/js/route-data.js', '/js/aws-config.js', '/css/style.css']) {
    assert.equal((await invoke('GET', asset)).statusCode, 200);
  }
  assert.equal(pools, 1); assert.equal(invokes, 0); assert.equal(queries, 1);
  console.log('Extracted Lambda verified: EJS/assets, strict TLS configuration, auth rejection, disabled setup. No live AWS/RDS calls.');
})().catch(error => { console.error('Lambda smoke test failed:', error.message); process.exitCode = 1; });
