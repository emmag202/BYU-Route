# BYU Ryde

University IS demo: **Render (Express + EJS) -> existing AWS Lambda -> existing private RDS PostgreSQL**.

Fictional accounts can sign up, log in, favorite routes, save a demo location, and reload their saved data after refresh. Use a demo username, an `@example.test` email, and a new password. This is not BYU identity verification. Maps, schedules, navigation, and styling remain the team's existing frontend.

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

The first should return `{"ok":true,"schema":"ryde_demo"}`; the second should return `{"ok":true,"database":"connected","schema":"ryde_demo"}`. Setup runs only the fixed `services/demo-schema.sql`, creates five tables and seeds seven routes. It leaves public/student tables untouched. Re-running preserves demo rows; it does not repair an incompatible manually created schema. The setup DB login needs CREATE on this database and ownership of the demo objects. Use a login limited to this classroom database; runtime needs only demo-table SELECT/INSERT/UPDATE/DELETE and identity-sequence privileges. If any database password was disclosed, rotate it and update Lambda's copied value together.

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

## Render setup and deployment

Use the existing Express Render service, recorded as **byu-ryde-team4-section4**. Confirm its repository/branch and auto-deploy setting before pushing. Keep work on **feature/fullstack-ejs**; do not change main. Build: **npm ci --omit=dev**. Start: **npm start**. Set Node version to **22** in Render's runtime setting or `NODE_VERSION=22`.

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

## Demonstrate and diagnose

1. Open the Render URL; create `demo-rider` / `demo-rider@example.test` with a new password.
2. Favorite a route, save a public campus/demo location, and refresh. Saved data should return from PostgreSQL.
3. Sign out and back in; confirm persistence. A second fictional account must have separate data. Changing account IDs in API URLs must return 403.
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
