CREATE TABLE IF NOT EXISTS uptime_metrics (
  environment  TEXT NOT NULL CHECK (environment IN ('prod', 'demo')),
  window_hours INTEGER NOT NULL,
  computed_at  INTEGER NOT NULL,
  ok_count     INTEGER NOT NULL,
  total_count  INTEGER NOT NULL,
  pct          REAL NOT NULL,
  PRIMARY KEY (environment, window_hours)
);
