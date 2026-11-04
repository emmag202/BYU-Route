require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const serverless = require("serverless-http");

const required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_SSL_CA"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing settings in .env: ${missing.join(", ")}`);
  process.exit(1);
}

const caPath = path.resolve(process.env.DB_SSL_CA);
if (!fs.existsSync(caPath)) {
  console.error(`RDS certificate bundle not found: ${caPath}`);
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { ca: fs.readFileSync(caPath, "utf8"), rejectUnauthorized: true },
  max: 5,
  connectionTimeoutMillis: 10000,
});

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
app.use(cors({
  origin(origin, callback) {
    const allowed = new Set([
      "https://emmag202.github.io",
      "http://localhost:5500",
      "http://127.0.0.1:5500",
    ]);
    if (!origin || allowed.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return callback(null, true);
    return callback(new Error("This local API only accepts requests from localhost."));
  },
}));
app.use(express.json({ limit: "20kb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/users/by-net-id/:netId", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT user_id, net_id, name, email FROM appuser WHERE net_id = $1",
      [req.params.netId.trim()],
    );
    res.json(result.rows[0] || null);
  } catch (error) { next(error); }
});

app.post("/api/users", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const netId = String(req.body.net_id || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!name || !netId || !email || name.length > 100 || netId.length > 50 || email.length > 100) {
      return res.status(400).json({ error: "Enter a name, Net ID, and email within the allowed lengths." });
    }
    if (!/^[^\s@]+@byu\.edu$/.test(email)) {
      return res.status(400).json({ error: "Use a valid email address ending in @byu.edu." });
    }
    const result = await pool.query(
      `INSERT INTO appuser (name, net_id, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (net_id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email
       RETURNING user_id, net_id, name, email`,
      [name, netId, email],
    );
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.get("/api/users/:userId/favorites", async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ error: "Invalid user ID." });
    const result = await pool.query(
      `SELECT r.route_name
       FROM favoriteroute f JOIN route r ON r.route_id = f.route_id
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
      `INSERT INTO favoriteroute (user_id, route_id)
       SELECT $1, route_id FROM route WHERE route_name = $2
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
      `DELETE FROM favoriteroute f USING route r
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
      "SELECT label, lat::float AS lat, lng::float AS lng FROM user_home WHERE user_id = $1",
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
      `INSERT INTO user_home (user_id, label, lat, lng)
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
    await pool.query("DELETE FROM user_home WHERE user_id = $1", [userId]);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error(error.message);
  if (error.code === "23505") return res.status(409).json({ error: "That email is already associated with another Net ID." });
  res.status(500).json({ error: "The database request failed. Check the local API and database connection." });
});

// API Gateway or a Lambda Function URL invokes this handler in AWS.
exports.handler = serverless(app);

// Keep the local workflow available for development in VS Code.
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, "127.0.0.1", () => console.log(`Ryde API listening at http://127.0.0.1:${port}`));
}

process.on("SIGINT", async () => { await pool.end(); process.exit(0); });
process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
