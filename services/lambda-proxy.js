// Lex backend workstream: IAM-signed Lambda Invoke, never the public Function URL.
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

function backendError(status, message) {
  return Object.assign(new Error(message), { status });
}

function createLambdaApi({ env = process.env, client, timeoutMs } = {}) {
  const region = env.AWS_REGION;
  const functionArn = env.RYDE_LAMBDA_FUNCTION_ARN;
  // Pin the actual function and region; a URL, client-provided target or other function is rejected.
  const configured = region === 'us-east-1' &&
    /^arn:aws:lambda:us-east-1:\d{12}:function:byu-ryde-api(?::[\w-]+)?$/.test(functionArn || '');
  const timeout = timeoutMs ?? Number(env.RYDE_LAMBDA_TIMEOUT_MS || 20000);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30000) throw new Error('Invalid Lambda timeout configuration.');
  let sdk = client;
  return {
    configured,
    async invoke(event) {
      if (!configured) throw backendError(503, 'Account backend configuration is unavailable.');
      // SDK credential provider chain: server environment/role only. No credentials in payloads.
      sdk ||= new LambdaClient({ region, maxAttempts: 1 });
      const controller = new AbortController();
      let timer;
      try {
        // No automatic retries of writes: a timeout does not prove the write failed.
        const response = await Promise.race([
          sdk.send(new InvokeCommand({
            FunctionName: functionArn, InvocationType: 'RequestResponse',
            Payload: Buffer.from(JSON.stringify(event)),
          }), { abortSignal: controller.signal }),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(backendError(504, 'Account backend timed out. Please check before retrying a change.'));
            }, timeout);
          }),
        ]);
        if (response.StatusCode !== 200 || response.FunctionError || !response.Payload || response.Payload.length > 100000) {
          throw backendError(502, 'Account backend returned an invalid response.');
        }
        const result = JSON.parse(Buffer.from(response.Payload).toString('utf8'));
        if (!result || !Number.isInteger(result.statusCode) || typeof result.body !== 'string' || result.isBase64Encoded) {
          throw backendError(502, 'Account backend returned an invalid response.');
        }
        return result;
      } catch (error) {
        if ([502, 504].includes(error.status)) throw error;
        if (controller.signal.aborted) throw backendError(504, 'Account backend timed out.');
        // Never expose SDK errors, credentials, SQL errors or Lambda logs to the browser.
        throw backendError(503, 'Account backend is unavailable.');
      } finally { clearTimeout(timer); }
    },
  };
}



// Render-only account transport. Browser sessions stay on Render; Lambda verifies account ownership.
const { COOKIE, TOKEN, sessionCookieOptions, readSession, csrfAllowed, createRateLimit } = require('./account-security');

const routes = [
  ['POST', /^\/api\/(login|users)$/], ['POST', /^\/api\/logout$/], ['GET', /^\/api\/me$/],
  ['GET', /^\/api\/users\/[1-9]\d{0,9}\/(favorites|home)$/],
  ['POST', /^\/api\/users\/[1-9]\d{0,9}\/favorites$/],
  ['DELETE', /^\/api\/users\/[1-9]\d{0,9}\/favorites\/10[1-7]$/],
  ['PUT', /^\/api\/users\/[1-9]\d{0,9}\/home$/],
  ['DELETE', /^\/api\/users\/[1-9]\d{0,9}\/home$/],
];

function validBody(method, path, body) {
  if (['GET', 'DELETE'].includes(method) || path === '/api/logout') return undefined;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  let keys;
  if (path === '/api/login') keys = ['net_id', 'password'];
  else if (path === '/api/users') keys = ['name', 'net_id', 'email', 'password'];
  else if (path.endsWith('/favorites')) keys = ['route_key'];
  else keys = ['label', 'lat', 'lng'];
  if (Object.keys(body).some(k => !keys.includes(k))) return null;
  const text = (key, max, min = 1) => typeof body[key] === 'string' && body[key].trim().length >= min && body[key].length <= max;
  if (keys.includes('password') && (!text('net_id', 50) || !text('password', 128, path === '/api/users' ? 8 : 1))) return null;
  if (path === '/api/users' && (!text('name', 100) || !text('email', 100) || !/^[^\s@]+@example\.test$/i.test(body.email))) return null;
  if (keys.includes('route_key') && (typeof body.route_key !== 'string' || !/^10[1-7]$/.test(body.route_key))) return null;
  if (keys.includes('lat') && (!text('label', 200) || typeof body.lat !== 'number' || typeof body.lng !== 'number' ||
    !Number.isFinite(body.lat) || !Number.isFinite(body.lng) || Math.abs(body.lat) > 90 || Math.abs(body.lng) > 180)) return null;
  return Object.fromEntries(keys.map(k => [k, body[k]]));
}

function containsSecret(body) {
  if (!body || typeof body !== 'object') return false;
  return Object.entries(body).some(([key, value]) => /^(password|password_hash|token|sessionToken|token_hash|secret)$/i.test(key) || containsSecret(value));
}

function createAccountProxy({ api, origin, rateLimit = createRateLimit(), production = process.env.NODE_ENV === 'production' }) {
  const validOrigin = (() => { try { const u = new URL(origin); return u.origin === origin && (u.protocol === 'https:' || (!production && ['localhost', '127.0.0.1'].includes(u.hostname))); } catch { return false; } })();
  return async function accountProxy(req, res) {
    res.set('Cache-Control', 'no-store');
    if (!api.configured || !validOrigin) return res.status(503).json({ error: 'Account backend configuration is unavailable.' });
    const path = req.originalUrl;
    if (!routes.some(([method, pattern]) => method === req.method && pattern.test(path))) return res.status(404).json({ error: 'Account endpoint not found.' });
    if (!csrfAllowed(req, origin)) return res.status(403).json({ error: 'Request origin could not be verified.' });
    // Use the socket/Express IP, never a custom identity or forwarded-IP header.
    // This is a conservative per-process scaffold, not distributed account-abuse protection.
    if (!rateLimit(req.ip)) return res.status(429).json({ error: 'Too many requests. Please wait before trying again.' });
    const session = readSession(req.get('cookie'));
    if (!['/api/login', '/api/users'].includes(path) && !session) return res.status(401).json({ error: 'Please sign in again.' });
    const body = validBody(req.method, path, req.body);
    if (body === null) return res.status(400).json({ error: 'Invalid account request.' });
    try {
      // Only the opaque session crosses the service boundary. Lambda validates it and owns authorization.
      // userId in the path is a resource selector, NEVER proof of identity.
      const result = await api.invoke({
        version: '2.0', routeKey: '$default', rawPath: path, rawQueryString: '',
        headers: { host: 'ryde-internal', 'content-type': 'application/json' },
        cookies: session ? [`${COOKIE}=${session}`] : [],
        requestContext: { http: { method: req.method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1' } },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), isBase64Encoded: false,
      });
      if (!Number.isInteger(result.statusCode) || result.statusCode < 200 || result.statusCode > 599) throw new Error('Invalid status');
      if (result.statusCode >= 400) {
        const status = [400, 401, 403, 409, 429, 503].includes(result.statusCode) ? result.statusCode : 502;
        return res.status(status).json({ error: status === 503 ? 'Account backend is unavailable.' : 'Unable to complete the account request.' });
      }
      if (![200, 201, 204].includes(result.statusCode)) throw new Error('Unexpected status');
      const data = result.statusCode === 204 ? null : JSON.parse(result.body);
      if (containsSecret(data)) throw new Error('Secret in response');
      const cookies = result.cookies || [];
      if (!Array.isArray(cookies) || cookies.length > 1 || result.headers?.['set-cookie'] || result.multiValueHeaders?.['set-cookie']) throw new Error('Invalid cookies');
      if (cookies.length) {
        const token = readSession(cookies[0]);
        if (path === '/api/logout' && /^ryde_session=;/.test(cookies[0])) {
          // Rebuild deletion attributes locally, never relay backend cookie headers.
        } else {
          if (!['/api/login', '/api/users'].includes(path) || !TOKEN.test(token || '')) throw new Error('Invalid session');
          res.cookie(COOKIE, token, { ...sessionCookieOptions(production), maxAge: 7 * 86400000 });
        }
      }
      if (['/api/login', '/api/users'].includes(path) && !cookies.length) throw new Error('Missing session');
      if (path === '/api/logout') res.clearCookie(COOKIE, sessionCookieOptions(production));
      if (result.statusCode === 204) return res.status(204).end();
      res.status(result.statusCode).json(data);
    } catch (error) {
      const status = [503, 504].includes(error.status) ? error.status : 502;
      res.status(status).json({ error: status === 504 ? 'Account backend timed out. Check before retrying a change.' : 'Account backend is unavailable.' });
    }
  };
}

module.exports = { createLambdaApi, createAccountProxy };
