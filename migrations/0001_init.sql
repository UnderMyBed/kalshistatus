CREATE TABLE IF NOT EXISTS snapshots (
  ts              INTEGER PRIMARY KEY,
  status          TEXT    NOT NULL,
  exchange_active INTEGER NOT NULL,
  trading_active  INTEGER NOT NULL,
  endpoints       TEXT    NOT NULL
);
