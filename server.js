// Express/EJS entry point, preserved PostgreSQL queries and Lambda handler; Lex backend workstream.
require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const express = require("express");
const { Pool } = require("pg");
const serverless = require("serverless-http");
const { createLambdaApi, createAccountProxy } = require("./services/lambda-proxy");
const { readSession, sessionCookieOptions } = require("./services/account-security");
const lambdaApi = createLambdaApi();
const isLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

// Optional RDS configuration: the website must still start without database access.
const required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_SSL_CA"];
const missing = required.filter((name) => !process.env[name]);
let pool = null;
// Render serves the website and invokes Lambda; only Lambda connects to RDS.
const allowDatabase = isLambda;
if (!allowDatabase) {
  console.info("Direct database access disabled: hosted web requests must use Lambda.");
} else if (!missing.length) {
  try {
    pool = new Pool({
      host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME, user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: { ca: fs.readFileSync(path.resolve(process.env.DB_SSL_CA), "utf8"), rejectUnauthorized: true },
      max: 2, connectionTimeoutMillis: 5000, statement_timeout: 5000,
    });
    pool.on("error", () => console.error("Idle database connection failed."));
  } catch {
    console.error("Database unavailable: check DB_SSL_CA and database configuration.");
  }
} else {
  console.warn(`Database unavailable: missing ${missing.join(", ")}. Routes and schedules remain available.`);
}

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 7;

async function makePasswordHash(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${Buffer.from(derived).toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  if (!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(String(storedHash || ""))) return false;
  const [, saltHex, hashHex] = storedHash.split("$");
  const expected = Buffer.from(hashHex, "hex");
  if (!expected.length) return false;
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltHex, "hex"), expected.length));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Session tokens are only sent as HttpOnly cookies.
function setSessionCookie(res, token) {
  res.cookie("ryde_session", token, { ...sessionCookieOptions(), maxAge: SESSION_DAYS * 86400000 });
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  await pool.query("DELETE FROM ryde_demo.appsession WHERE expires_at <= CURRENT_TIMESTAMP");
  await pool.query(
    "INSERT INTO ryde_demo.appsession (user_id, token_hash, expires_at) VALUES ($1, $2, CURRENT_TIMESTAMP + ($3 * INTERVAL '1 day'))",
    [userId, tokenHash, SESSION_DAYS],
  );
  return token;
}

// Injectable query dependency lets authorization be tested without touching RDS.
function buildRequireAuth(database) {
  return async function requireAuth(req, res, next) {
    const token = readSession(req.get("cookie"));
    if (!token) return res.status(401).json({ error: "Please sign in again." });
    try {
      const tokenHash = hashSessionToken(token);
      const result = await database.query(
        "SELECT user_id FROM ryde_demo.appsession WHERE token_hash = $1 AND expires_at > CURRENT_TIMESTAMP",
        [tokenHash],
      );
      if (!result.rows[0]) return res.status(401).json({ error: "Your session expired. Please sign in again." });
      req.authUserId = Number(result.rows[0].user_id);
      req.authTokenHash = tokenHash;
      if (req.params.userId && Number(req.params.userId) !== req.authUserId) {
        return res.status(403).json({ error: "You can only access your own account." });
      }
      next();
    } catch (error) { next(error); }
  };
}
const requireAuth = buildRequireAuth(pool);

const routeNames = {
  "101": "West Route",
  "102": "Wyview Route",
  "103": "Branbury Route",
  "104": "King Henry Route",
  "105": "South/Joaquin Route",
  "106": "Heritage Overflow Parking",
  "107": "Wymount Route",
};
const routeKeys = Object.fromEntries(Object.entries(routeNames).map(([key, name]) => [name, key]));

const app = express();
app.disable("x-powered-by");
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use((_req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
app.use(express.static(path.join(__dirname, "public"), { maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
app.get(["/", "/index.html"], (_req, res) => res.render("index"));
app.use(express.json({ limit: "20kb" }));

app.get("/api/health", (_req, res) => res.json({
  ok: true,
  database: pool ? "configured-unverified" : "unavailable",
  profiles: (pool || lambdaApi.configured) ? "demo-accounts" : "unavailable",
  lambda: lambdaApi.configured ? "configured-unverified" : "unavailable",
}));

// Web requests always go through the IAM-signed proxy. There is no direct RDS fallback.
const accountPaths = ["/api/users", "/api/login", "/api/logout", "/api/me"];
app.use(accountPaths, (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
if (!isLambda) {
  app.use(accountPaths, createAccountProxy({ api: lambdaApi, origin: process.env.APP_ORIGIN }));
} else {
  app.use(accountPaths, (_req, res, next) => {
    if (!pool) return res.status(503).json({ error: "Demo database is not configured." });
    next();
  });
}

app.post("/api/login", async (req, res, next) => {
  try {
    const netId = String(req.body.net_id || "").trim();
    const password = String(req.body.password || "");
    if (!netId || netId.length > 50 || !password || password.length > 128) return res.status(400).json({ error: "Enter your username and password." });
    const result = await pool.query(
      "SELECT user_id, net_id, name, email, password_hash FROM ryde_demo.appuser WHERE net_id = $1",
      [netId],
    );
    const user = result.rows[0];
    const fallbackHash = "scrypt$" + "0".repeat(32) + "$" + "0".repeat(128);
    const matches = await verifyPassword(password, user?.password_hash || fallbackHash);
    if (!user || !matches) return res.status(401).json({ error: "Unable to sign in with those credentials." });
    const token = await createSession(user.user_id);
    delete user.password_hash;
    setSessionCookie(res, token);
    res.json({ user });
  } catch (error) { next(error); }
});

app.post("/api/logout", requireAuth, async (req, res, next) => {
  try {
    await pool.query("DELETE FROM ryde_demo.appsession WHERE token_hash = $1", [req.authTokenHash]);
    res.clearCookie("ryde_session", sessionCookieOptions());
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get("/api/me", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT user_id, net_id, name, email FROM ryde_demo.appuser WHERE user_id = $1",
      [req.authUserId],
    );
    res.json(result.rows[0] || null);
  } catch (error) { next(error); }
});

app.post("/api/users", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const netId = String(req.body.net_id || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!name || !netId || !email || name.length > 100 || netId.length > 50 || email.length > 100) {
      return res.status(400).json({ error: "Enter a name, username, and email within the allowed lengths." });
    }
    if (!/^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: "Choose a password between 8 and 128 characters." });
    const passwordHash = await makePasswordHash(password);
    const result = await pool.query(
      `INSERT INTO ryde_demo.appuser (name, net_id, email, password_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (net_id) DO NOTHING
       RETURNING user_id, net_id, name, email`,
      [name, netId, email, passwordHash],
    );
    const user = result.rows[0];
    if (!user) return res.status(409).json({ error: "An account already exists with that username. Sign in instead." });
    const token = await createSession(user.user_id);
    setSessionCookie(res, token);
    res.json({ user });
  } catch (error) { next(error); }
});

app.use("/api/users/:userId", requireAuth);

app.get("/api/users/:userId/favorites", async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ error: "Invalid user ID." });
    const result = await pool.query(
      `SELECT r.route_name
       FROM ryde_demo.favoriteroute f JOIN ryde_demo.route r ON r.route_id = f.route_id
       WHERE f.user_id = $1 ORDER BY r.route_name`,
      [userId],
    );
    res.json(result.rows.map((row) => routeKeys[row.route_name]).filter(Boolean));
  } catch (error) { next(error); }
});

app.post("/api/users/:userId/favorites", async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    const routeName = routeNames[String(req.body.route_key)];
    if (!Number.isInteger(userId) || userId < 1 || !routeName) return res.status(400).json({ error: "Invalid user or route." });
    await pool.query(
      `INSERT INTO ryde_demo.favoriteroute (user_id, route_id)
       SELECT $1, route_id FROM ryde_demo.route WHERE route_name = $2
       ON CONFLICT (user_id, route_id) DO NOTHING`,
      [userId, routeName],
    );
    res.status(204).end();
  } catch (error) { next(error); }
});

app.delete("/api/users/:userId/favorites/:routeKey", async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    const routeName = routeNames[String(req.params.routeKey)];
    if (!Number.isInteger(userId) || userId < 1 || !routeName) return res.status(400).json({ error: "Invalid user or route." });
    await pool.query(
      `DELETE FROM ryde_demo.favoriteroute f USING ryde_demo.route r
       WHERE f.route_id = r.route_id AND f.user_id = $1 AND r.route_name = $2`,
      [userId, routeName],
    );
    res.status(204).end();
  } catch (error) { next(error); }
});

// Saved home address: one row per user in user_home.
app.get("/api/users/:userId/home", async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ error: "Invalid user ID." });
    const result = await pool.query(
      "SELECT label, lat::float AS lat, lng::float AS lng FROM ryde_demo.user_home WHERE user_id = $1",
      [userId],
    );
    res.json(result.rows[0] || null);
  } catch (error) { next(error); }
});

app.put("/api/users/:userId/home", async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    const label = String(req.body.label || "").trim();
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ error: "Invalid user ID." });
    if (!label || label.length > 200) return res.status(400).json({ error: "Enter an address up to 200 characters." });
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return res.status(400).json({ error: "That address has invalid map coordinates." });
    }
    const result = await pool.query(
      `INSERT INTO ryde_demo.user_home (user_id, label, lat, lng)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET label = EXCLUDED.label, lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = CURRENT_TIMESTAMP
       RETURNING label, lat::float AS lat, lng::float AS lng`,
      [userId, label, lat, lng],
    );
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23503") return res.status(404).json({ error: "That profile no longer exists. Sign in again." });
    next(error);
  }
});

app.delete("/api/users/:userId/home", async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ error: "Invalid user ID." });
    await pool.query("DELETE FROM ryde_demo.user_home WHERE user_id = $1", [userId]);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.use("/api", (_req, res) => res.status(404).json({ error: "API endpoint not found." }));
app.use((error, _req, res, _next) => {
  // Parser/DB exception messages can contain request values. Log only a classification.
  console.error('API request failed:', error.type || error.code || 'unexpected-error');
  if (error.code === "23505") return res.status(409).json({ error: "An account already exists with that username or email. Please sign in instead." });
  if (error.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body." });
  if (error.type === "entity.too.large") return res.status(413).json({ error: "Request body is too large." });

  res.status(500).json({ error: "The database request failed. Check the Lambda database connection." });
});

// API Gateway or a Lambda Function URL invokes this handler in AWS.
const lambdaHandler = serverless(app);
exports.handler = async (event, context) => {
  const result = await lambdaHandler(event, context);
  // Express can emit a single cookie as a string; normalize to the v2 cookie envelope.
  if (event.version === "2.0" && result.headers?.["set-cookie"]) {
    result.cookies = [result.headers["set-cookie"]];
    delete result.headers["set-cookie"];
  }
  return result;
};
// Temporary console-only bootstrap: switch the handler back to server.handler immediately.
// This function accepts no arbitrary SQL and never returns database error details.
exports.setup = async (event) => {
  if (process.env.DEMO_SETUP_ENABLED !== "true" || !pool) throw new Error("Demo setup is disabled or database is not configured.");
  if (event?.action === "install-demo-schema") {
    // A single checked-out client keeps the migration transaction on one connection.
    const client = await pool.connect();
    try {
      await client.query(fs.readFileSync(path.join(__dirname, "services/demo-schema.sql"), "utf8"));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Demo schema setup failed:", error.code || "unexpected-error");
      throw new Error("Demo schema setup failed; check CloudWatch classification and DB privileges.");
    } finally { client.release(); }
    return { ok: true, schema: "ryde_demo" };
  }
  if (event?.action === "remove-demo-email-constraint") {
    // Only the original schema's email-domain CHECK may be removed.
    // One atomic statement; repeat invocations are harmless once it is absent.
    await pool.query(`DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'ryde_demo.appuser'::regclass
            AND conname = 'appuser_email_check'
        ) THEN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'ryde_demo.appuser'::regclass
              AND conname = 'appuser_email_check' AND contype = 'c'
              AND regexp_replace(pg_get_expr(conbin, conrelid), '[()[:space:]]', '', 'g')
                = 'email::text~~''%@example.test''::text'
          ) THEN
            RAISE EXCEPTION 'Unexpected appuser_email_check definition; no changes made';
          END IF;
          ALTER TABLE ryde_demo.appuser DROP CONSTRAINT IF EXISTS appuser_email_check;
        END IF;
      END; $$;`);
    return { ok: true, schema: "ryde_demo" };
  }
  if (event?.action === "check-demo-database") {
    await pool.query("SELECT user_id FROM ryde_demo.appuser LIMIT 0");
    await pool.query("SELECT route_id FROM ryde_demo.route LIMIT 0");
    return { ok: true, database: "connected", schema: "ryde_demo" };
  }
  throw new Error("Unknown demo setup action.");
};
exports.app = app;
exports.authInternals = { makePasswordHash, verifyPassword, hashSessionToken, requireAuth, buildRequireAuth, sessionCookieOptions };

// Keep the local workflow available for development in VS Code.
if (require.main === module && !isLambda) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, process.env.HOST || "0.0.0.0", () => console.log(`BYU Ryde listening at http://localhost:${port}`));
}

process.on("SIGINT", async () => { await pool?.end(); process.exit(0); });
process.on("SIGTERM", async () => { await pool?.end(); process.exit(0); });
