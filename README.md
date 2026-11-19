# BYU Ryde

University IS demo: **Render (Express + EJS) -> existing AWS Lambda -> existing private RDS PostgreSQL**.

Accounts can sign up with any valid email address, log in, favorite routes, save a location, and reload their saved data after refresh. Use a username, email, and password. This is not BYU identity verification. Maps, schedules, navigation, and styling remain the team's existing frontend.

## Run and test

Use Node.js 22. In PowerShell:

```powershell
npm ci
Copy-Item .env.example .env  # Only if .env does not already exist
npm start
```

Set the Express variables below in `.env`, then open **http://localhost:3000**. Local Express uses the same Lambda backend as Render; it never connects directly to RDS. Without backend settings, routes still work and account APIs return 503.

```powershell
npm test
./package-lambda.ps1
```

The single packaging command builds **artifacts/ryde-lambda.zip**, checks the CA/dependencies and native binaries, then extracts and smoke-tests that exact ZIP. It cleans only its new temporary extraction after success. Previous ZIPs are retained rather than overwritten. No command here deploys or changes AWS.

If the public RDS CA is missing before packaging:

```powershell
Invoke-WebRequest -Uri 'https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem' -OutFile global-bundle.pem
```

## One-time AWS setup (existing resources only)

The repository records Lambda **byu-ryde-api**, region **us-east-1**, RDS **database-1**, database **postgres**. Confirm those names in your console. No new database is required; `ryde_demo` is just a separate group of demo tables inside the existing database.

1. In **RDS -> database-1 -> Connectivity & security**, keep public access **No**. In **Lambda -> byu-ryde-api -> Configuration -> VPC**, keep Lambda in the same VPC as RDS. RDS inbound TCP **5432** must allow the **Lambda security group**; Lambda outbound must permit that connection. Preserve its existing CloudWatch/VPC execution-role permissions. Do not add public database access. [AWS RDS connection guidance](https://docs.aws.amazon.com/lambda/latest/dg/services-rds.html).
2. Keep **Configuration -> Function URL -> Auth type = AWS_IAM**. Render uses IAM-signed direct Invoke, not this URL. [AWS Function URL authentication](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html).
3. Save the existing Lambda code/config privately for reference, then **Code -> Upload from -> .zip file -> artifacts/ryde-lambda.zip**. This replaces `$LATEST`; older code may contain unsafe legacy account logic. Use runtime **Node.js 22.x**, memory **256 MB**, timeout **15 seconds**, handler **server.handler**. Preserve unrelated configuration. [AWS ZIP packaging](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-package.html).
4. Under **Configuration -> Environment variables**, set the following. Lambda supplies its own AWS execution credentials; do not add Render's access keys here.

| Lambda setting | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DB_HOST` | Existing RDS endpoint hostname, without https:// or port |
| `DB_PORT` | `5432` |
| `DB_NAME` | Actual database name, recorded as `postgres` |
| `DB_USER` | Authorized demo database login |
| `DB_PASSWORD` | Current password, entered privately in AWS |
| `DB_SSL_CA` | `/var/task/global-bundle.pem` |

5. Create the demo tables once: temporarily set **handler = server.setup**, add **DEMO_SETUP_ENABLED=true**, then in the Lambda **Test** tab invoke these two events in order:

```json
{"action":"install-demo-schema"}
```

```json
{"action":"check-demo-database"}
```

The first should return `{"ok":true,"schema":"ryde_demo"}`; the second should return `{"ok":true,"database":"connected","schema":"ryde_demo"}`. Setup runs only the fixed `services/demo-schema.sql`, creates six tables, seeds seven routes, and adds BYU academic-calendar dates for the public no-class notice. The notice reports academic-calendar dates only and does not claim buses are canceled. It leaves public/student tables untouched. Re-running preserves demo rows; it does not repair an incompatible manually created schema. The setup DB login needs CREATE on this database and ownership of the demo objects. Use a login limited to this classroom database; runtime needs only demo-table SELECT/INSERT/UPDATE/DELETE and identity-sequence privileges. If any database password was disclosed, rotate it and update Lambda's copied value together.

6. **Immediately restore handler = server.handler and remove DEMO_SETUP_ENABLED.** No accounts-enable flag is needed. Do not run the archived public-schema migrations.
7. Give the existing Render invocation principal this policy on the actual **unqualified** function ARN (replace ACCOUNT_ID). If none exists, create a dedicated IAM user without console access and enter its access key privately in Render. Same-account direct Invoke needs this scoped permission; no Function URL permission, RDS permission, or administrator policy is needed. [AWS identity-based policies](https://docs.aws.amazon.com/lambda/latest/dg/access-control-identity-based.html).

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "lambda:InvokeFunction",
    "Resource": "arn:aws:lambda:us-east-1:ACCOUNT_ID:function:byu-ryde-api"
  }]
}
```

## Update an existing installation to accept any email

1. Run `npm test` and `./package-lambda.ps1`. Upload **artifacts/ryde-lambda.zip** to the existing **us-east-1 / byu-ryde-api** function under **Code -> Upload from -> .zip file**, then save. Wait for the update to finish.
2. Set **DEMO_SETUP_ENABLED=true** in environment variables and temporarily set **Runtime settings -> Handler** to **server.setup**. Preserve the existing DB settings. The DB login must own `ryde_demo.appuser` (or have equivalent privileges).
3. In **Test**, invoke `{"action":"remove-demo-email-constraint"}`. Expect `{"ok":true,"schema":"ryde_demo"}`. This repeatable action removes only the original `appuser_email_check` after verifying its definition; it preserves all tables, rows, UNIQUE constraints, and other CHECK constraints. An unexpected definition fails without changes. Do not run `install-demo-schema` for this update.
4. Immediately restore **server.handler** and remove **DEMO_SETUP_ENABLED**, even if the test fails. Save both changes and wait for completion.
5. When ready to release, commit/push the reviewed code to Render's configured branch, then use **Manual Deploy -> Deploy latest commit** on the existing Render service (or let enabled auto-deploy finish). Keep its build/start commands and environment unchanged. If the Lambda ARN uses an alias/version, point that existing release target at the updated code before deploying Render.
6. Verify signup with Gmail/BYU/Outlook, sign out/in, and refresh saved favorites/home. Duplicate emails must still fail.

## Render setup and deployment

Use the existing Express Render service, recorded as **byu-ryde-team4-section4**. Confirm its repository/branch and auto-deploy setting before pushing. Use the configured deployment branch (currently main). Build: **npm ci --omit=dev**. Start: **npm start**. Set Node version to **22** in Render's runtime setting or `NODE_VERSION=22`.

| Render variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_ORIGIN` | Exact Render browser origin, e.g. `https://YOUR-SERVICE.onrender.com`, no trailing slash/path |
| `AWS_REGION` | `us-east-1` |
| `RYDE_LAMBDA_FUNCTION_ARN` | Actual unqualified function ARN from Lambda overview |
| `AWS_ACCESS_KEY_ID` | Scoped Render invocation key ID |
| `AWS_SECRET_ACCESS_KEY` | Scoped Render invocation secret |

Do not put DB credentials on Render or AWS credentials in browser files. Temporary AWS credentials additionally need the matching `AWS_SESSION_TOKEN`; remove stale tokens for a long-lived IAM user key. Old `DEMO_ACCOUNTS_ENABLED` settings are unused and can be removed. The invocation timeout defaults to 20 seconds, longer than Lambda's 15-second timeout.

After the reviewed changes reach Render's configured branch, deploy/restart the service. Nothing has been committed, pushed or deployed by this cleanup. For local development use the same variables in `.env`, with NODE_ENV=development and APP_ORIGIN=http://localhost:3000.

The browser's existing **Amazon Location public API key** is separate from backend AWS credentials. In AWS, confirm its allowed website/referrer list includes the actual Render domain and its permissions remain limited to the map/search/routing features used by the app. Retain the Pages domain if teammates use it.

## Trip assistant (home page question box)

The home page question box posts to **POST /api/chat** on the Express server (never Lambda). Google Gemini reads the question into typed JSON fields, Amazon Location finds the places, and `services/trip-planner.js` builds the answer from the published timetable. Gemini's output is validated field by field; it never writes the answer and never supplies a time.

Set `GEMINI_API_KEY` in `.env` locally and in Render's environment (`GEMINI_MODEL` overrides the default `gemini-3.5-flash-lite`). Without the key the box answers "not set up" and the rest of the site works. The typed question and public place names go to Gemini; rider coordinates stay on the server. Free-tier Gemini keys are rate-limited and Google may use free-tier requests to improve its products. UTA legs link out to live transit directions because the app holds no UTA schedule data. The GitHub Pages copy (`index.html`) has no server and keeps the old search bar.

## Demonstrate and diagnose

1. Open the Render URL; create `demo-rider` / `demo-rider@example.test` with a new password.
2. Favorite a route, save a public campus/demo location, and refresh. Saved data should return from PostgreSQL.
3. Sign out and back in; confirm persistence. A second account must have separate data. Changing account IDs in API URLs must return 403.
4. Anonymous Function URL access should still return AWS 403.

Passwords use salted scrypt hashes; only session hashes are stored in PostgreSQL. Cookies are HttpOnly/Secure/SameSite=Strict in production. Account writes require the exact origin and custom request header; SQL uses parameters and ownership checks. DB TLS verifies the RDS CA. A simple per-process limiter allows 20 requests/minute per peer IP; Render may share a proxy IP, so wait one minute if you see 429 during a demo. No distributed infrastructure is added.

**Verification:** 17 automated tests cover EJS/assets, seven routes, preserved page/style structure, browser syntax, signed invocation configuration, CSRF, cookie handling, password/session checks, cross-user denial, and the complete Render-to-Lambda flow with mocked database persistence. The packaging command separately verifies the extracted handler. They do not prove a live AWS connection, real PostgreSQL DDL/permissions, or external map services. `/api/health` reports configuration only; use the one-time setup check plus the browser demo above for live verification.

**Failures:** 503: missing ARN/origin/credentials or unavailable Lambda; 403 on writes: APP_ORIGIN mismatch; timeout: VPC/SG/database status; SQLSTATE 28P01: DB credentials; 42501: DB privileges; 42P01: schema setup/DB_NAME mismatch. Check sanitized CloudWatch errors; never log passwords, request bodies, cookies or environment values.

## Repository cleanup and recovery

| Root item(s) reviewed | Decision |
| --- | --- |
| `server.js`, `views/`, `public/`, `ryde-erd.png` | Keep application/UI and ERD. Teammate maps, schedules, navigation, and styles preserved. |
| `services/` | Consolidate AWS invocation + proxy into `lambda-proxy.js`; keep shared `account-security.js` and one `demo-schema.sql`. |
| `scripts/`, `package-lambda.ps1` | Consolidate into one package command plus its offline `smoke-lambda.js` checker. |
| `tests/` | Keep app, transport/security and full-flow tests; replace duplicate disabled-account scaffolding with enabled-flow coverage. |
| `index.html`, root `aws-config.js`, `route-data.js`, `route-map.js` | Keep original Pages implementation in place for teammates. Root files are Pages assets; `public/` is the Express version. Pages account calls are not the authenticated Render frontend; do not reopen anonymous Lambda access for them. |
| `.env.example`, `.gitignore`, `package.json`, `package-lock.json`, `.git/` | Keep configuration, locked dependencies and history. Remove unused CORS dependency and direct-local-DB script. Git metadata/main are untouched. |
| `home-address.sql`, `password-auth-migration.sql`, `migrate-home.js` | Archive under `archive/legacy-db/`; not current demo setup. |
| `AWS_SETUP.md`, `LAMBDA_DEPLOYMENT.md`, `LOCAL_SETUP.md`, `TEAM_GUIDE.md`, `TESTING.md` | Consolidate useful instructions into this README; prior copies preserved privately in backup. |
| `lambda-events/`, old verification/setup scripts | Remove from active tree; preserve originals in backup. Current console events are inline above. |
| `artifacts/lambda-review-*`, old generated ZIP/manifest | Remove from active tree by moving intact into ignored backup. New ZIP lives under ignored `artifacts/`; new verification extraction is temporary. |
| `node_modules/`, `global-bundle.pem`, `.env` (if present), `.backups/`, `artifacts/` | Keep local/generated/private only; excluded from Git. Dependencies are reproducible with npm ci. CA is public trust material. |

Before editing, branch/status/history and all source files were saved and byte-verified in **.backups/before-cleanup-20261110-114906/** (`source-before-cleanup.zip`, `uncommitted.patch`, status/history, inventory). Retired files and old generated artifacts were also moved there intact. Recover individual files from that ZIP or the retired folders; do not overwrite newer work with a bulk restore. Backup may contain private local configuration and must stay out of Git.

History attributes Emma's account UI and Calvin's layout work; uncommitted changes were conservatively backed up regardless of attribution. No reset, force-push, commit, deployment, main-branch change or AWS modification was performed.


### OKR dashboard deployment

Open `/okr` directly and enter the team password. Totals reload on opening, browser refresh, or **Refresh counters**. A signed team cookie lasts 12 hours; the metrics API checks it on Render and Lambda. A trip is counted once when a rider opens a route and its itinerary renders; GPS updates and stop changes do not add events. Restoring a trip from browser history does not add an event. Walking directions open Google Maps for the boarding stop and record one click. Event failures do not interrupt trip planning and are not retried automatically.

Deploy the changed `server.js`, `services/lambda-proxy.js`, `views/`, and `public/` through GitHub/Render. **Separately** run `./package-lambda.ps1` and upload the resulting `artifacts/ryde-lambda.zip` to AWS Lambda **byu-ryde-api**, keeping handler `server.handler` and existing environment variables/credentials. Deploy Lambda first so the new endpoints are ready for Render. GitHub/Render deployment does not update Lambda. Do not run schema setup; the dashboard uses the existing `ryde_demo.okr_dashboard` view and `analytics_events` table.

After deployment, note `/okr` totals, create an account, save a favorite, open a route itinerary, and click walking directions. Refresh `/okr` and verify each relevant total increased. Routes Saved measures current favorites, so removing a favorite decreases it. Local automated tests use a mocked database; real PostgreSQL counts require this deployed check.


### Final presentation deployment

Favorites: open a route, choose **Save Favorite** / **Unsave Favorite**. **My profile** lists saved routes and opens them. For a home address, choose **Save home address** / **Update home address** in the profile, search on the map, select a suggestion (or a result marker), then choose **Save as home** in the popup. Remove it from the profile. All saved state uses the existing user API and reloads from PostgreSQL.

Calendar: Emma's existing notice displays up to three upcoming date ranges returned by `/api/academic-calendar/no-class-days`. It loads on startup and refreshes the Routes home. No rows or an unavailable API hides the notice. The old Lambda package lacks this endpoint. No live database access was available during these edits, so whether production dates are populated is unverified. Run the first SELECT in `scripts/calendar-check.sql` in your existing database editor. Only if entries are missing, run the INSERT below it; it adds missing project dates without changing existing rows. Do not run `server.setup` or the full schema script.

1. Privately set **OKR_ADMIN_PASSWORD** to the same nonempty shared password in Render's service **Environment** and AWS Lambda **byu-ryde-api ? Configuration ? Environment variables**. Keep all existing AWS/RDS settings. Do not put the value in source files. Changing this password invalidates existing team cookies.
2. From the repository root, run `npm ci`, `npm test`, then `./package-lambda.ps1` in PowerShell. This builds and checks a fresh ZIP without deploying.
3. In AWS Lambda **byu-ryde-api ? Code ? Upload from ? .zip file**, upload `artifacts/ryde-lambda.zip` and save. Keep handler `server.handler` and the existing runtime/configuration. If Render targets a Lambda alias, publish the new version and point that existing alias at it.
4. Commit/push the changes on `main`, then use Render **Manual Deploy ? Deploy latest commit** (or its existing automatic deploy). Keep `APP_ORIGIN` set to the exact Render site origin. Render's usual `npm install` / `npm start` settings stay the same.
5. Verify signup/login; save, refresh, open, and unsave a favorite; save/update/remove a home; and confirm the calendar API returns dates. Visit `/okr` privately, enter the shared password, and verify all four counters. An unauthenticated `/api/okr` request must return 401; normal student navigation has no dashboard link.

No production database changes or deployments were performed by this implementation.

## IS 401 Admin CRUD Assignment

The existing site hosts the portal at `/okr`. Configure `OKR_ADMIN_EMAIL` privately on Render and `OKR_ADMIN_PASSWORD` to the same strong value on Render and Lambda. An administrator signs in with that email and password; rider sessions do not grant access. Render validates both values and invokes Lambda using IAM. Lambda checks a signed, expiring cookie and a hashed session record on every administrative request and OKR read. Logout deletes that record before clearing the cookie, so a copied cookie cannot be replayed. If the backend is unavailable, logout reports failure; retry or rotate the shared password. Existing password-only OKR cookies become invalid after this update.

Maintain Users creates, lists, edits, resets passwords for, and deletes `ryde_demo.appuser` accounts. Passwords are salted and hashed with scrypt. Deleting a user cascades to their favorites, home and rider sessions. Maintain Records covers `route`, `favoriteroute`, `user_home` and `academic_no_class_day`; user and route relationships use selectors. Existing published routes cannot be renamed or deleted because the public app references their names; changes to database routes do not update maps or timetables. A referenced route cannot be deleted until its favorites are removed. Session tables, raw analytics, and derived OKR views are security or reporting data and are deliberately excluded from CRUD.

**Local tests:** run `npm test`; tests use mocks and do not verify a production database. Local Express invokes the configured Lambda, so interactive local use requires an appropriately configured test Lambda and `APP_ORIGIN`.

**Deployment order (manual; no deployment performed here):**

1. Back up the existing Lambda version and configuration. Apply only `services/admin-session-migration.sql` using an authorized database migration connection. It creates one session table and index without changing existing data. Grant the Lambda runtime role SELECT, INSERT and DELETE on `ryde_demo.admin_session`. Do not run the full schema installer.
2. Privately configure the same `OKR_ADMIN_PASSWORD` in Lambda and Render; set `OKR_ADMIN_EMAIL` in Render, and confirm `APP_ORIGIN` exactly matches the site origin. Keep unrelated configuration unchanged.
3. Run `npm ci`, `npm test`, and `./package-lambda.ps1`. Upload the verified ZIP to the existing Lambda, keeping `server.handler`, VPC, credentials and runtime settings. If an alias is used, update the existing alias to the new version.
4. Deploy the reviewed web code to the existing Render service using its established deployment process. Lambda must be updated separately; Render does not update it.
5. Safely smoke-test with a temporary account and a temporary route: verify login, all four OKR counters, CRUD, logout and rejection of a copied cookie; then remove only the temporary records. Verify the public routes, rider login, favorites, home and calendar. Never edit the seven published routes or existing users for a smoke test. Test the other business tables with temporary data only.

**Rollback:** restore the previous Render release and Lambda version together and restore their prior environment configuration. Existing data remains intact. Once no deployed version uses the new portal, an authorized operator may drop `ryde_demo.admin_session` using the rollback statement in the migration; this invalidates all admin sessions. Do not drop other tables or run the schema installer.

**Private TA submission checklist:** Set an authorized grading email and a unique strong password in the service environments as above; provide the deployed `/okr` URL, email, and password to the instructor through a private channel. Do not commit credentials. Rotate the password after grading, which invalidates all existing signed sessions.
