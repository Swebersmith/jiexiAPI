CREATE TABLE IF NOT EXISTS service_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
