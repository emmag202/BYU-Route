// One-time migration: creates the user_home table.
// Uses the same .env and RDS certificate as server.js.
// Run from the API folder:  node migrate-home.js
require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

(async () => {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { ca: fs.readFileSync(path.resolve(process.env.DB_SSL_CA), "utf8"), rejectUnauthorized: true },
    connectionTimeoutMillis: 10000,
  });
  await client.connect();
  await client.query(fs.readFileSync(path.join(__dirname, "home-address.sql"), "utf8"));
  const check = await client.query("SELECT to_regclass('public.user_home') AS t");
  console.log(check.rows[0].t ? "user_home table is ready." : "Table was not created — check the output above.");
  await client.end();
})().catch((error) => { console.error("Migration failed:", error.message); process.exit(1); });
