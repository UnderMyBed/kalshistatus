CREATE TABLE IF NOT EXISTS region_probes (
  environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')),
  region      TEXT NOT NULL CHECK (region IN ('us-east', 'eu-west', 'asia')),
  probed_at   INTEGER NOT NULL,
  payload     TEXT NOT NULL,
  PRIMARY KEY (environment, region)
);
