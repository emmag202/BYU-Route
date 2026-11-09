-- Adds password hashes and revocable sign-in sessions for password-based accounts.
-- Existing appuser rows keep their profiles, favorites, and home addresses.

ALTER TABLE public.appuser
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE TABLE IF NOT EXISTS public.appsession (
  session_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INT NOT NULL REFERENCES public.appuser(user_id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS appsession_user_id_idx
  ON public.appsession(user_id);

CREATE INDEX IF NOT EXISTS appsession_expires_at_idx
  ON public.appsession(expires_at);


