CREATE TABLE IF NOT EXISTS snapshots (
  ts          INTEGER NOT NULL,
  environment TEXT    NOT NULL CHECK (environment IN ('prod', 'demo')),
  payload     TEXT    NOT NULL,
  PRIMARY KEY (environment, ts)
);

