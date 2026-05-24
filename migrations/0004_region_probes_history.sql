-- Allow multiple region probes per (environment, region) over time so we can
-- show real regional history instead of just the latest single row.

DROP TABLE IF EXISTS region_probes;

CREATE TABLE region_probes (
  environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')),
  region      TEXT NOT NULL CHECK (region IN ('us-east', 'eu-west', 'asia')),
  probed_at   INTEGER NOT NULL,
  payload     TEXT NOT NULL,
  PRIMARY KEY (environment, region, probed_at)
);

CREATE INDEX region_probes_probed_at_idx ON region_probes (environment, probed_at DESC);
