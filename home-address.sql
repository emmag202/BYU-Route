-- BYU Ryde: saved home address (one per user). PostgreSQL / RDS.
-- Run once. migrate-home.js runs this same statement for you.

CREATE TABLE IF NOT EXISTS user_home (
  user_id    INT PRIMARY KEY REFERENCES appuser(user_id) ON DELETE CASCADE,
  label      VARCHAR(200) NOT NULL,
  lat        DECIMAL(9,6) NOT NULL,
  lng        DECIMAL(9,6) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
