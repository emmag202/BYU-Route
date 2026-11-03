# BYU Ryde Shuttle App

## 1. App Summary

BYU Ryde is a web app that helps students explore BYU shuttle routes, stops, and scheduled departures. It includes an interactive route map, route schedules, and a user profile feature that saves information between visits.

## 2. ERD

Our relational database models users, routes, stops, buses, and their relationships.

![BYU Ryde ERD](ryde-erd.png)

## 3. Tech Stack

- **HTML, CSS, JavaScript:** Frontend interface, map, schedules, and user interactions.
- **Node.js and Express:** Local server-side API for profile and favorite-route requests.
- **Amazon RDS for PostgreSQL:** Stores user profiles, favorite routes, route data, stops, and timetable data.

The browser calls the API; only the API connects to PostgreSQL. Database credentials belong in local configuration, never in `index.html` or GitHub.

## 4. Run Locally

1. Install Node.js 20 or later.
2. In this folder, copy `.env.example` to `.env` and fill in the RDS endpoint and database password.
3. Download the AWS RDS global certificate bundle as `global-bundle.pem` into this folder. The bundle is ignored by Git.
4. Open a terminal in this folder and run `npm install`, then `npm start`.
5. In another VS Code terminal, start Live Server for `index.html` (usually `http://127.0.0.1:5500`).
6. The RDS security group must allow PostgreSQL (port 5432) from this laptop's current public IP.

For local development, the API listens only on this laptop. For AWS deployment, run `npm install` and `./package-lambda.ps1` to create `ryde-lambda.zip`; the package script intentionally excludes `.env`. In Lambda, set the database environment variables, attach the function to the same VPC as RDS, and permit its security group to reach RDS on port 5432. Create a Function URL with CORS origin `https://emmag202.github.io`, then replace `API_BASE_URL` in `index.html` with that URL before pushing to GitHub Pages.

The published timetable display is still hard-coded in `index.html`; profile and favorite-route data use the API.

## 5. Verifying the Vertical Slice

Our vertical slice is **Save Profile**.

1. Open the application and navigate to the profile section.
2. Enter a Net ID, name, and email.
3. Click **Save Profile** and confirm the saved information appears.
4. Refresh the page and reopen the profile section.
5. Confirm the saved information is still there.

The profile is stored in the RDS `appuser` table and retrieved after refreshing, demonstrating persistent data storage. Favorite routes are stored in `favoriteroute`.

Link to DEMO Video:
https://drive.google.com/file/d/1teh6GizUji3yptUHIkroI10ENTW-uH7p/view?usp=sharing
