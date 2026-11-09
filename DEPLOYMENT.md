# Render Free preparation (not deployed)

The team reports an existing Render Free service: **byu-ryde-team4-section4**, https://byu-ryde-team4-section4.onrender.com. No Render settings or live state were inspected or changed during this integration. Keep the existing GitHub connection, service and Pages configuration. Expected settings: repository root; build `npm ci`; start `npm start`; health `/api/health`. Verify the existing deployment branch and automatic-deploy behavior before any approved push; a push could trigger deployment. Do not create a replacement service.

## Environment

Set `NODE_ENV=production`. Render supplies `PORT`; the app defaults to `0.0.0.0` (`HOST` may override it). Use Node.js 22+ supported by the host. Routes/schedules require no database variables.

Optional RDS variables: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL_CA` (path to a privately provisioned certificate bundle). These do not enable profile endpoints: authentication is still required. No private keys/configuration should enter Git or `public/`. Existing `public/js/aws-config.js` contains a public Amazon Location browser key, not an AWS signing secret. The AWS owner must verify allowed localhost, GitHub Pages and approved Render origins and minimal map/place/route actions before hosting. Do not place private AWS credentials there.

## Private RDS and Lambda decision

Do not connect Render directly to private RDS or open its security group. Proposed future path: authenticated browser session -> Render -> existing Lambda in RDS VPC -> RDS. No proxy is implemented. Database configuration alone must not enable accounts; `/api/users`, `/api/login`, `/api/logout`, and `/api/me` remain blocked with 503.

AWS Function URL `AWS_IAM` requires server-side SigV4 signing and least-privilege invoke permissions; `NONE` provides no Lambda authentication. A service credential authenticates Render, not the student. Lambda must also validate the trusted, tamper-proof user identity and enforce ownership for every profile/favorite/home request. Reject arbitrary user IDs and Net IDs. A shared key in browser JavaScript is insufficient. Sessions need secure cookies, CSRF protection, expiry and rate limits. Coordinate the identity implementation and Lambda API contract with Emma and the AWS owner before enabling persistence. See [AWS invocation documentation](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html).

Ask the administrator for the existing Function URL/API contract and auth mode, approved method of obtaining scoped signing credentials, identity provider/test accounts, non-production data, database reachability within its current VPC, table permissions and TLS CA bundle. Do not exchange credentials in GitHub/Trello. The deployed Lambda remains unchanged and needs a separate security review.

## Verification after an approved deployment

Check `/`, `/index.html`, `/css/style.css`, `/js/app.js`, and `/api/health`. Health `ok` confirms the web process only; `configured-unverified` is not a DB connection test. Verify all seven routes, schedule days, search, both directions, trip start/end, map controls and address search; verify 320/375/390px layouts. Personal-data endpoints must currently return 503. Confirm `.env`, server code and certificates return 404. Review browser console and network errors. Never use real data for tests.

Free services sleep after 15 minutes idle and may start slowly; the filesystem is ephemeral. Keep current RDS/Lambda as the persistence system. Check current [Render Free limits](https://render.com/docs/free) and [web-service setup](https://render.com/docs/web-services) before deployment. No domain purchase or DNS change is needed. No service, infrastructure, data or hosting settings have been changed by this migration.

## Before enabling Emma's authentication

1. Approve a verified enrollment and legacy-account recovery process. Net ID/email matching is not verification. The Node registration query never updates an existing passwordless account. New accounts must not impersonate BYU identities either; keep registration blocked until verification exists.
2. Review and explicitly approve `password-auth-migration.sql` against the intended database. Emma/AWS owner must apply it in the approved environment and verify `appuser.password_hash`, `appsession`, indexes and least-privilege table/sequence grants. No schema changes were run here.
3. Keep Lambda in the existing RDS VPC with strict CA verification and existing network rules. Confirm test credentials and the TLS bundle privately. Implement the authenticated Render-to-Lambda API; do not put RDS on the public internet or add direct Render access to bypass this gap.
4. Decide which component issues and verifies session cookies. Current dormant Express code prepares HttpOnly/SameSite=Strict cookies, Secure under `NODE_ENV=production`, seven-day expiry and hashed DB tokens. Browser tokens are not returned in JSON. Implement explicit same-origin/CSRF validation, login throttling, generic credential errors with enumeration/timing protection, verified recovery, and end-to-end session revocation tests before removing the gate. The cookie code alone is not a completed authentication rollout.
5. Test the complete path with approved non-production accounts: registration verification, existing-account rejection/recovery, login/logout/me, expired sessions, CSRF attempts and cross-user favorites/home denial. Applying SQL, providing credentials, or granting permissions alone is insufficient.

Root `index.html` contains the upstream legacy Pages account implementation, including browser bearer tokens. Its configuration is preserved, but Node safeguards do not secure that separately deployed client/backend. Review it with the Lambda owner before publishing upstream account changes. This integration is safe to review as a gated Node update, not a release of working authentication.
