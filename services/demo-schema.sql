-- Isolated school-demo data. Existing public tables are never modified.
BEGIN;
CREATE SCHEMA IF NOT EXISTS ryde_demo;
CREATE TABLE IF NOT EXISTS ryde_demo.appuser (
 user_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 net_id VARCHAR(50) NOT NULL UNIQUE,
 name VARCHAR(100) NOT NULL,
 email VARCHAR(100) NOT NULL UNIQUE,
 password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ryde_demo.appsession (
 token_hash VARCHAR(64) PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES ryde_demo.appuser ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS demo_session_expiry ON ryde_demo.appsession(expires_at);
CREATE TABLE IF NOT EXISTS ryde_demo.route (
 route_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 route_name VARCHAR(100) NOT NULL UNIQUE
);
INSERT INTO ryde_demo.route(route_name) VALUES
 ('West Route'), ('Wyview Route'), ('Branbury Route'), ('King Henry Route'),
 ('South/Joaquin Route'), ('Heritage Overflow Parking'), ('Wymount Route')
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS ryde_demo.favoriteroute (
 user_id INTEGER NOT NULL REFERENCES ryde_demo.appuser ON DELETE CASCADE,
 route_id INTEGER NOT NULL REFERENCES ryde_demo.route,
 PRIMARY KEY(user_id, route_id)
);
CREATE TABLE IF NOT EXISTS ryde_demo.user_home (
 user_id INTEGER PRIMARY KEY REFERENCES ryde_demo.appuser ON DELETE CASCADE,
 label VARCHAR(200) NOT NULL,
 lat NUMERIC(9,6) NOT NULL CHECK(lat BETWEEN -90 AND 90),
 lng NUMERIC(9,6) NOT NULL CHECK(lng BETWEEN -180 AND 180),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ryde_demo.academic_no_class_day (
 start_date DATE NOT NULL,
 end_date DATE NOT NULL,
 label VARCHAR(160) NOT NULL,
 source_url TEXT NOT NULL,
 PRIMARY KEY (start_date, end_date),
 CHECK (end_date >= start_date)
);
INSERT INTO ryde_demo.academic_no_class_day (start_date, end_date, label, source_url) VALUES
 ('2026-11-25', '2026-11-25', 'No classes at BYU', 'https://academiccalendar.byu.edu/'),
 ('2026-11-26', '2026-11-27', 'Thanksgiving holiday — no classes', 'https://academiccalendar.byu.edu/'),
 ('2026-12-25', '2026-12-26', 'Christmas holiday — no classes', 'https://academiccalendar.byu.edu/'),
 ('2026-12-31', '2027-01-01', 'New Year holiday — no classes', 'https://academiccalendar.byu.edu/'),
 ('2027-01-18', '2027-01-18', 'Martin Luther King Jr. Day — no classes', 'https://academiccalendar.byu.edu/'),
 ('2027-03-19', '2027-03-19', 'No classes at BYU', 'https://academiccalendar.byu.edu/'),
 ('2027-05-31', '2027-05-31', 'Memorial Day — no classes', 'https://academiccalendar.byu.edu/'),
 ('2027-06-18', '2027-06-18', 'Juneteenth — no classes', 'https://academiccalendar.byu.edu/'),
 ('2027-07-05', '2027-07-05', 'Independence Day holiday — no classes', 'https://academiccalendar.byu.edu/'),
 ('2027-07-23', '2027-07-23', 'Pioneer Day holiday — no classes', 'https://academiccalendar.byu.edu/')
ON CONFLICT (start_date, end_date) DO UPDATE
 SET label = EXCLUDED.label, source_url = EXCLUDED.source_url;
COMMIT;
