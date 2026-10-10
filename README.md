# BYU Ryde Shuttle App

## 1. App Summary

BYU Ryde is a web app that helps students explore BYU shuttle routes, stops, and scheduled departures. It includes an interactive route map, route schedules, and a user profile feature that saves information between visits.

## 2. ERD

Our relational database models users, routes, stops, buses, and their relationships.

![BYU Ryde ERD](ryde-erd.png)

## 3. Tech Stack

- **HTML, CSS, JavaScript:** Frontend interface, map, schedules, and user interactions.
- **Supabase (PostgreSQL):** Backend database for storing and retrieving user profiles.

We chose these tools for their simplicity and easy database integration.

## 4. How to Get It Running

1. Download or clone this repository.
2. Open `index.html` using VS Code Live Server.
3. Ensure the Supabase project URL, publishable key, and database tables are configured.
4. An internet connection is required for database access.

## 5. Verifying the Vertical Slice

Our vertical slice is **Save Profile**.

1. Open the application and navigate to the profile section.
2. Enter a Net ID, name, and email.
3. Click **Save Profile** and confirm the saved information appears.
4. Refresh the page and reopen the profile section.
5. Confirm the saved information is still there.

The profile is stored in the Supabase `users` table and retrieved after refreshing, demonstrating persistent data storage.

Link to DEMO Video:
https://drive.google.com/file/d/1teh6GizUji3yptUHIkroI10ENTW-uH7p/view?usp=sharing
