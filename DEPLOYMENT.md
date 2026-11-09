# Render Free preparation (not deployed)

After approval, connect the GitHub account authorized for `emmag202/BYU-Route` in Render and create a **Web Service**, Node runtime, Free instance. Select the reviewed branch/commit; proposed name: `byu-ryde-team4-section4`. Proposed URL: https://byu-ryde-team4-section4.onrender.com (availability unverified). Root directory: repository root; build: `npm ci`; start: `npm start`; health path: `/api/health`. Disable automatic deploys until team approval. Keep GitHub Pages settings and root static files unchanged.

## Environment

Set `NODE_ENV=production`. Render supplies `PORT`; the app defaults to `0.0.0.0` (`HOST` may override it). Use Node.js 22+ supported by the host. Routes/schedules require no database variables.

Optional RDS variables: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL_CA` (path to a privately provisioned certificate bundle). These do not enable profile endpoints: authentication is still required. No private keys/configuration should enter Git or `public/`. Existing `public/js/aws-config.js` contains a public Amazon Location browser key, not an AWS signing secret. The AWS owner must verify allowed localhost, GitHub Pages and approved Render origins and minimal map/place/route actions before hosting. Do not place private AWS credentials there.

## Private RDS and Lambda decision

Do not connect Render directly to private RDS or open its security group. Proposed future path: authenticated browser session -> Render -> existing Lambda in RDS VPC -> RDS. No proxy is enabled in this migration because there is no verified identity/ownership contract.

AWS Function URL `AWS_IAM` requires server-side SigV4 signing and least-privilege invoke permissions; `NONE` provides no Lambda authentication. A service credential authenticates Render, not the student. Lambda must also validate the trusted, tamper-proof user identity and enforce ownership for every profile/favorite/home request. Reject arbitrary user IDs and Net IDs. A shared key in browser JavaScript is insufficient. Sessions need secure cookies, CSRF protection, expiry and rate limits. Coordinate the identity implementation and Lambda API contract with Emma and the AWS owner before enabling persistence. See [AWS invocation documentation](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html).

Ask the administrator for the existing Function URL/API contract and auth mode, approved method of obtaining scoped signing credentials, identity provider/test accounts, non-production data, database reachability within its current VPC, table permissions and TLS CA bundle. Do not exchange credentials in GitHub/Trello. The deployed Lambda remains unchanged and needs a separate security review.

## Verification after an approved deployment

Check `/`, `/index.html`, `/css/style.css`, `/js/app.js`, and `/api/health`. Health `ok` confirms the web process only; `configured-unverified` is not a DB connection test. Verify all seven routes, schedule days, search, both directions, trip start/end, map controls and address search; verify 320/375/390px layouts. Personal-data endpoints must currently return 503. Confirm `.env`, server code and certificates return 404. Review browser console and network errors. Never use real data for tests.

Free services sleep after 15 minutes idle and may start slowly; the filesystem is ephemeral. Keep current RDS/Lambda as the persistence system. Check current [Render Free limits](https://render.com/docs/free) and [web-service setup](https://render.com/docs/web-services) before deployment. No domain purchase or DNS change is needed. No service, infrastructure, data or hosting settings have been changed by this migration.
