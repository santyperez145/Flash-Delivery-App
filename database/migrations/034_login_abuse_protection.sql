ALTER TABLE users
  ADD COLUMN failed_login_attempts integer NOT NULL DEFAULT 0 CHECK(failed_login_attempts >= 0),
  ADD COLUMN login_locked_until timestamptz,
  ADD COLUMN last_login_at timestamptz;

CREATE INDEX users_login_locked_idx ON users(login_locked_until)
  WHERE login_locked_until IS NOT NULL;
