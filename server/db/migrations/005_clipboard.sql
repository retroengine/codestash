CREATE TABLE clipboard_entries (
  code        CHAR(4) PRIMARY KEY,
  content     TEXT,
  file_path   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_clipboard_expiry ON clipboard_entries(expires_at);
