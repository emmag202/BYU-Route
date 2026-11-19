-- Apply once with a privileged database migration connection. Does not modify existing records.
CREATE TABLE IF NOT EXISTS ryde_demo.admin_session (
 token_hash CHAR(64) PRIMARY KEY,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_session_expiry ON ryde_demo.admin_session (expires_at);
-- Rollback after disabling the portal: DROP TABLE ryde_demo.admin_session;
