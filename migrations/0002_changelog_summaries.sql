CREATE TABLE IF NOT EXISTS changelog_summaries (
  link         TEXT PRIMARY KEY,
  pub_date_ts  INTEGER NOT NULL,
  title        TEXT NOT NULL,
  summary_ai   TEXT NOT NULL,
  generated_at INTEGER NOT NULL
);
