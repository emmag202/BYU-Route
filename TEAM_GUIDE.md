# BYU Ryde team guide

## Install and run

Clone https://github.com/emmag202/BYU-Route.git (not a ZIP), open the cloned folder, use Node.js 22+, then run `npm install` and `npm start`. Visit http://localhost:3000. No Live Server or database is required to browse routes. Run `npm test` for migration checks.

## Where to work

These are sprint focus areas, not exclusive ownership. Coordinate overlapping edits.

| Teammate | Actual files and checks |
| --- | --- |
| Daniel: maps/navigation | `public/js/route-map.js`, `public/js/route-data.js`; map shell in `views/index.ejs`. Check AWS place search, route lines, stop markers and To/From Campus location selection. Preserve latest main's walking-direction reverts. |
| Emma: accounts/schedules | `public/js/app.js` (profile forms, day schedules, End Trip), `views/index.ejs`, `public/css/style.css`; coordinate `server.js` with Lex for secure authentication and persistence. |
| Calvin: routes/UX | `public/js/app.js` (cards, departure times, stops, trip controls), `public/css/style.css`, `views/index.ejs`, `views/partials/header.ejs`. Check direction hierarchy and phone layouts. |
| Lex: backend/security | `server.js`, `package.json`, `package-lock.json`, `.env.example`, `.gitignore`, `package-lambda.ps1`, `tests/migration.test.js`, deployment docs. |

`index.html` and root browser scripts are the preserved GitHub Pages version. Node edits belong in `views/` and `public/`; coordinate deliberate matching changes for Pages. The existing route-map image stays embedded in `app.js`. The ERD stays at `ryde-erd.png`.

## Git workflow

First check `git status`. Commit or safely stash your own unfinished work before switching branches; never discard someone else's changes. With a clean tree:

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/short-task-name
```

On an existing task branch, fetch and coordinate merging `origin/main` instead of overwriting work. After editing and testing:

```bash
git status
git add <specific-files>
git commit -m "Describe your change"
git push -u origin feature/short-task-name
```

Open a GitHub Pull Request into `main` with the Trello card, behavior change and test results. Request teammate review. Never force-push or push directly to `main`. The migration branch is `feature/fullstack-ejs`. Migration commit `24fe79b` already exists; the integration of Emma's `fd30f95` is a local, uncommitted merge for review. Do not switch branches or start another merge while this merge is pending. Inspect `git status`, `git diff --cached`, and `git diff`; commit/push only after approval.

## Shared configuration and bugs

Coordinate server/API contracts, public AWS key restrictions, SQL/migrations, npm dependencies, Lambda packaging, `.env.example`, GitHub Pages and Render settings. Never commit secrets, `.env`, certificates or `node_modules`. The Amazon Location key is intentionally browser-visible; ask the AWS owner to restrict origins/actions. Private AWS credentials belong only server-side.

Accounts/favorites/home addresses deliberately return unavailable until verified authentication and ownership checks exist. Do not bypass this gate for a presentation using real users. Ask Emma/AWS administrator for approved identity integration, a test dataset, TLS bundle and existing Lambda access/authentication details; do not widen RDS access.

Report bugs in a GitHub issue or Trello card with branch/commit, URL/hash, browser, viewport, steps, expected/actual result, screenshot and console/network errors. Remove names, emails, home addresses and credentials. See `TESTING.md` for remaining checks.

## Emma account integration

Emma's Create Account and Sign In forms, validation, and account options now live in `public/js/app.js`; EJS keeps the existing modal shell. `server.js` retains scrypt hashes, hashed seven-day revocable sessions, and ownership checks. Session transport is prepared for HttpOnly/SameSite=Strict cookies (Secure in production); the active browser never stores or sends bearer tokens. Account routes remain unconditionally blocked, including login/logout/me, until secure enrollment and infrastructure are ready. No environment setting bypasses the gate.

`password-auth-migration.sql` is Emma's unexecuted schema change, outside `public/`. Never claim a passwordless account with just its Net ID/email; the inherited claim query was removed. Emma/AWS owner must approve verified enrollment/recovery, schema migration, non-production tests and the authenticated Lambda contract. CSRF and login-abuse protections must be implemented and tested before activation. Passwords here are intended as separate Ryde credentials, never BYU passwords. The untouched legacy GitHub Pages script uses Emma's original token design; it has not received the Node security changes and must be reviewed separately before publishing.
