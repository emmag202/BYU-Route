-- Run this read-only query first in your existing PostgreSQL query editor.
SELECT start_date, end_date, label, source_url
FROM ryde_demo.academic_no_class_day
ORDER BY start_date;

-- Only if dates below are missing: insert the existing project calendar entries.
-- Existing rows and all other project data are left untouched.
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
ON CONFLICT (start_date, end_date) DO NOTHING;
