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
