# Admin & OKR Portal deployment runbook

This is a manual release plan for the existing Render service, existing Lambda `byu-ryde-api` in `us-east-1`, and its private PostgreSQL RDS database. No production change is made by this document. Review the release and obtain the required authorization before executing it.

## Preflight and database migration

1. Identify the existing Render deploy and Lambda version/alias currently serving traffic; save the prior Lambda package or publishable version, exact prior environment settings, and Render release. Check whether Render environment changes trigger automatic deployment, and coordinate the release window. Lambda-first causes a temporary OKR outage for the old Render release because its old-format cookies are rejected. Public rider APIs should remain available.
2. Confirm the actual Lambda PostgreSQL login (the private `DB_USER` value), database name, and existing table, view, sequence and schema privileges. Use an approved private database connection; never make RDS public. The migration executor needs CONNECT on the database and USAGE and CREATE on `ryde_demo`, or must be its owner. If the table already exists, `IF NOT EXISTS` does not validate or repair it: inspect its columns, constraints, ownership and index before proceeding, and stop on mismatch. Creating the index on an existing table requires ownership of that table (or equivalent role membership).
3. Run **only** the following migration as the authorized owner, in the existing database; do not run `services/demo-schema.sql` or `server.setup`:

```sql
CREATE TABLE IF NOT EXISTS ryde_demo.admin_session (
  token_hash CHAR(64) PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_session_expiry
  ON ryde_demo.admin_session (expires_at);
```

4. The administrator of the database must ensure that the actual Lambda database login has USAGE on `ryde_demo`; SELECT, INSERT and DELETE on `admin_session`; SELECT, INSERT, UPDATE and DELETE on `appuser`, `route`, `favoriteroute`, `user_home`, and `academic_no_class_day`; and SELECT on `okr_dashboard`. Retain its existing analytics and rider privileges. Where grants are missing, substitute the **actual PostgreSQL login identifier**, properly double-quoted, for `<lambda_db_role>` below and have the object owner or an authorized grantor run the needed statements:

```sql
GRANT USAGE ON SCHEMA ryde_demo TO <lambda_db_role>;
GRANT SELECT, INSERT, DELETE ON ryde_demo.admin_session TO <lambda_db_role>;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  ryde_demo.appuser, ryde_demo.route, ryde_demo.favoriteroute,
  ryde_demo.user_home, ryde_demo.academic_no_class_day TO <lambda_db_role>;
GRANT SELECT ON ryde_demo.okr_dashboard TO <lambda_db_role>;
```

The migration executor or object owner must be able to grant the relevant privileges. Preserve the existing sequence permissions for user and route identity generation; check actual associated names using the read-only query below, and if required grant USAGE on **only those sequences** to the Lambda database login. Do not substitute an AWS IAM role for the PostgreSQL login.

```sql
SELECT pg_get_serial_sequence('ryde_demo.appuser', 'user_id') AS user_sequence,
       pg_get_serial_sequence('ryde_demo.route', 'route_id') AS route_sequence;
-- If needed, for each actual schema-qualified sequence returned:
-- GRANT USAGE ON SEQUENCE <actual_schema.actual_sequence> TO <lambda_db_role>;
```

## Configuration and release

5. In Render's existing service, privately set `OKR_ADMIN_EMAIL` to the intended administrator's email. Set `OKR_ADMIN_PASSWORD` to the existing shared admin password or a newly chosen strong secret, using the **same exact value** in Render and Lambda. Never place either value in source, a shell history, logs, or the submission document. Lambda needs `OKR_ADMIN_PASSWORD` but does not need the email. Confirm `APP_ORIGIN` on Render is the exact public origin, including scheme and port if present, with no path or trailing slash. Retain `NODE_ENV=production`, Lambda ARN/region, IAM invocation access, RDS connection and TLS settings. Coordinate configuration and release so a mismatch is brief; changing the password invalidates current OKR cookies.
6. Run `npm test` and `./package-lambda.ps1` from the repository root. Wait for `Verified upload` and the SHA-256; do not use a ZIP from an interrupted run. In Lambda `byu-ryde-api`, upload the verified `artifacts/ryde-lambda.zip`; preserve `server.handler`, Node.js 22 runtime, VPC, environment and execution role. Wait for the update to succeed. If Render invokes an alias, publish the version and update that **existing** alias according to the established process.
7. Only after Lambda is ready, publish the reviewed source through the existing Render service's established process, with the user's separate authorization to commit/push/deploy. Ensure the deployed revision matches the package's source. Wait for the service to become healthy. No second site, database setup, AWS networking change, or public RDS access is required.

## Safe production smoke test

8. In a private browser, open `/okr`: without authentication, maintenance controls and `/api/okr` and `/api/admin/users` must be inaccessible. Sign in with the configured email/password and check the four existing counters load. Wrong email or password must fail. A separate rider session must not grant administrator access.
9. Create a uniquely named temporary user with a unique Net ID/email, note its identity, display it, edit its name or email, and verify the edit. Create a uniquely named temporary route, display and edit it. Use only these temporary identities for relationship tests. Create, view and edit a favorite association between the temporary user and temporary route; verify deleting that route while the favorite exists returns a clear conflict. Delete the temporary favorite. Create, view, edit and delete a saved home for the temporary user using harmless test coordinates and a non-personal label. Create, view, edit and delete a uniquely labelled temporary calendar entry on an unused date range, with a harmless HTTPS source. These changes can affect public notices temporarily; choose a date outside the visible upcoming window. If any date conflicts, stop and choose another; never overwrite an existing row.
10. Delete the temporary route and temporary user, confirming their names and IDs before deletion. Never edit or delete the seven published routes or preexisting users. Record which temporary records were created so they can be individually removed if a step fails. User deletion also cascades the user's favorites, home, and rider sessions.
11. For a controlled copied-cookie check, privately save the `ryde_okr` cookie only in a secure local test client, without logging or sharing it. Log out in the browser; verify `/okr` returns the login form and browser access to both admin APIs and `/api/okr` fails. Replay the saved cookie through that private client against both `/api/admin/users` and `/api/okr`; both must return 401. Discard the saved cookie. Verify rider login, a preexisting route's public schedule/map display, favorites, home and calendar using a dedicated test account without changing other users' records.

## Rollback

12. If migration fails, stop before deploying; inspect database state and privileges without rerunning the full installer. If Lambda fails, restore the prior Lambda version/package and prior settings, including alias if applicable; keep Render on its previous release. If Render fails after Lambda changed, restore the prior Render release and Lambda version together, with their prior matching configuration. Confirm rider APIs and the prior OKR login behavior. The new table can remain unused during rollback. Only after no release needs it, the table owner may execute `DROP TABLE ryde_demo.admin_session;` to remove it, which destroys all new admin sessions. Do not drop any other table or restore an old full schema. Data changes made during smoke testing must be cleaned up by their recorded unique identities, not by resetting the database.

The automated tests and ZIP smoke test use mocks and do not validate real PostgreSQL constraints, deployment credentials, Lambda invocation, the Render environment, or production data. Complete the production smoke test after a separately authorized deployment.
