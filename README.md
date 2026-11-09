# BYU Ryde Shuttle App

## 1. App Summary

BYU Ryde is a web app that helps students explore BYU shuttle routes, stops, and scheduled departures. It includes an interactive route map, route schedules, and a user profile feature that saves information between visits.

## 2. ERD

Our relational database models users, routes, stops, buses, and their relationships.

![BYU Ryde ERD](ryde-erd.png)

## 3. Tech Stack

- **EJS, CSS, JavaScript:** Frontend interface, map, schedules, and user interactions.
- **Node.js and Express:** Page rendering, static assets, and the preserved database API (currently protected by a fail-closed account gate).
- **Amazon RDS for PostgreSQL:** Stores user profiles, favorite routes, route data, stops, and timetable data.

The browser calls the API; only the API connects to PostgreSQL. Database credentials belong in local configuration, never in `index.html` or GitHub.

## 4. Run locally

**Start with [TEAM_GUIDE.md](TEAM_GUIDE.md)** for file locations and the team Git workflow. See [DEPLOYMENT.md](DEPLOYMENT.md) for hosting preparation and [TESTING.md](TESTING.md) for validation and remaining checks.

Install Node.js 22 or later, then:

```bash
npm install
npm start
```

Open **http://localhost:3000**. Express renders `views/index.ejs`; styling and browser code live in `public/`. No Live Server or database credentials are required for routes and schedules. Timetables remain the team's existing browser data in `public/js/app.js`.

The original `index.html`, `route-map.js`, `route-data.js`, and `aws-config.js` remain unchanged for GitHub Pages. They are a legacy static version, not the Node source. Coordinate equivalent changes when maintaining both versions. Express never serves the repository root.

## 5. Profiles, database and Lambda

**Personal-data APIs are blocked with HTTP 503 pending secure sign-in.** The previous implementation treated a typed Net ID as identity and exposed profiles, favorites and home addresses through user IDs. The migrated UI explains this limitation. No database operation is represented as successful while blocked.

All original parameterized SQL queries and strict RDS TLS verification remain in `server.js`. Optional settings are listed in `.env.example`; use a private `.env` and the administrator-provided certificate. Do not run `migrate-home.js` or change schemas as part of this migration.

The existing Lambda `exports.handler` remains, and its package script now includes views and static assets. No AWS deployment has been performed. **The already deployed Lambda has not been secured by these local changes**; its owner must review its current public profile endpoints. Do not test it using real user IDs. GitHub Pages still points to that existing backend.

The historical Save Profile vertical slice demonstrated RDS `appuser` persistence and `favoriteroute` persistence. Its original demo and ERD are retained below; it cannot be repeated on the migrated app until authentication and per-user authorization are implemented. An email suffix check is not authentication.

Link to DEMO Video:
https://drive.google.com/file/d/1teh6GizUji3yptUHIkroI10ENTW-uH7p/view?usp=sharing
