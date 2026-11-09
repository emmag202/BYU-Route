# Emma account integration validation ? November 9, 2026

## Current local integration

- Started from clean `feature/fullstack-ejs` at `24fe79b`; fetched `origin/main` and inspected all divergent changes. Only new commit: `fd30f95`, Emma's "create account and login" (five changed files).
- Ran `git merge --no-commit --no-ff origin/main`. Resolved `server.js`, `.env.example` and README by combining the migration's optional database/EJS/hosting setup with Emma's account code. The merge remains uncommitted for approval.
- Transferred the account JavaScript from main's HTML into `public/js/app.js`, preserving same-origin API requests. EJS, CSS, maps, route data, schedules and navigation stay intact. No deployment configuration changes or SQL execution.
- `npm test`: **9 passing, 0 failing**. Existing five migration checks plus account form rendering in a VM, password/salt verification, malformed hash rejection, cookie flags, protected routes with forged identities/tokens/cookies, and stubbed authorization tests for missing/expired/foreign/own sessions. No real database calls in these tests.
- `node --check server.js`, `node --check public/js/app.js`, and conflict/whitespace checks run during integration. Route/data files and EJS/CSS unchanged from migration commit. HTML/asset/syntax and Lambda health checks pass.
- All account endpoints intentionally return 503 with no-store and no session cookie. The gate cannot be enabled through environment variables. Legacy-account password claiming was removed; browser session secrets are not stored or sent by the active Node frontend.

## Limits and remaining checks

No new browser interaction or viewport tests were performed. Form tests execute the actual UI rendering functions against minimal DOM substitutes; they do not verify browser validation, click/submit interactions or layout. Previous browser access limitations and the manual teammate checklist below still apply.

No AWS credentials, Lambda proxy, live sessions, RDS access, SQL migrations or production writes were tested. Cookie transport/hashing/authorization code is preserved behind the gate, not an activated login system. Explicit CSRF protection, throttling, verified enrollment/recovery, and full session integration must be implemented/tested before activation. Root Pages code is upstream's separate legacy token client and does not inherit Node protections.

Safe to review for the existing Render branch while the gate remains; not ready to announce working authentication. Any push/deployment requires approval and verification of automatic deploy behavior. No commit, push, merge into main, deployment or AWS changes made.

---

# Migration validation — November 9, 2026

## Ran successfully

- Verified the Git remote is `emmag202/BYU-Route`, the working tree initially clean, and the branch `feature/fullstack-ejs`. Fetched origin and advanced the branch from `16c8234` to latest main `b6683d8` before editing. This includes the intentional walking-direction reverts. No migration commit or push was made.
- `npm install ejs`, `npm install`, and lockfile update completed. Initial install audit reported zero vulnerabilities.
- `npm start` started the app at http://localhost:3000 without DB settings; the process reports unavailable database configuration.
- `npm test`: **5 passing tests**. HTTP rendering and `/index.html` alias; all local frontend script/CSS URLs; preserved page IDs and script order; unchanged CSS content; byte-identical map/data/public-key scripts; seven map routes; browser JavaScript syntax; same-origin API base; health response; all eight personal-data methods blocked with 503/no-store; private-file 404s; unknown API 404; invalid JSON 400; oversized JSON 413; Lambda handler health invocation.
- `node --check server.js` and `git diff --check` passed.
- Compared root static files and SQL/migration files with `origin/main`: unchanged. GitHub Pages source and ERD/demo retained.

These are HTTP, syntax and preservation tests, not browser interaction tests or a live database connection test. Health reports `configured-unverified` when settings exist, never claims a successful database connection.

## Unverified / unavailable

The browser access host reported unavailable. Native Chrome selection also failed because its window was minimized. No interactive/browser or viewport checks passed. No claim is made about 320px, 375px or 390px overflow. Existing CSS fixes are preserved, but need actual visual verification.

No AWS credentials or database settings were present. No external Lambda, RDS, AWS map/places/routes requests, real user data or migrations were tested. The Lambda package script was updated but not executed because the required certificate is absent. AWS infrastructure and deployed Lambda remain unchanged.

Accounts, favorites and saved-home endpoints intentionally return 503 pending verified authentication and ownership enforcement. UI and parameterized queries remain available for that implementation. The existing deployed Lambda may still have the original unauthenticated endpoints; the administrator must review it separately.

## Teammate checks before merge/deployment

- **Daniel:** all seven route geometries/markers, zoom/geolocation, AWS place search/autocomplete, calculated routes, To/From Campus location selection and map navigation. Confirm reverted walking-direction behavior matches main; do not restore it inadvertently.
- **Emma:** day picker and day-specific schedules, profile modal/validation/unavailable message, trip start/end; coordinate secure account authentication and authorized profile/favorite/home persistence with Lex. Use approved test users only after access is ready.
- **Calvin:** cards/search/filtering, departures/remaining stops, To/From Campus hierarchy, route details and trip controls. At 320/375/390px verify no page overflow, tappable controls, timetable scrolling and modal fit; also test desktop.
- **Lex/AWS administrator:** approved identity integration and Lambda ownership contract, test environment/data, function URL auth mode, scoped invocation access and TLS CA bundle. Confirm browser-key restrictions include approved origins/actions; keep RDS private. See `DEPLOYMENT.md`.

The branch is suitable for a **draft PR/review after approval to commit/push**, with these limitations disclosed. It is not ready for full-stack deployment or final merge sign-off until browser checks and authenticated persistence are resolved. Hosting settings are prepared, but nothing has been deployed.
