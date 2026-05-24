import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { saveSnapshot, loadLatestSnapshot, pruneSnapshots, saveRegionProbe, loadRecentRegionProbes } from '../src/storage';
import type { Snapshot, RegionProbe } from '../src/types';

function makeSnapshot(environment: 'prod' | 'demo', ts: number): Snapshot {
  return {
    ts,
    environment,
    status: 'operational',
    exchange: { exchange_active: true, trading_active: true },
    endpoints: [],
    regions: [],
  };
}

const REGION_PROBES_SCHEMA = `CREATE TABLE IF NOT EXISTS region_probes (environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')), region TEXT NOT NULL CHECK (region IN ('us-east', 'eu-west', 'asia')), probed_at INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (environment, region))`;

beforeEach(async () => {
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS snapshots (ts INTEGER NOT NULL, environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')), payload TEXT NOT NULL, PRIMARY KEY (environment, ts))`,
  );
  await env.DB.exec(REGION_PROBES_SCHEMA);
  await env.DB.prepare('DELETE FROM snapshots').run();
  await env.DB.prepare('DELETE FROM region_probes').run();
});

describe('saveSnapshot / loadLatestSnapshot', () => {
  it('saves a snapshot and retrieves it', async () => {
    const snap = makeSnapshot('prod', 1000);
    await saveSnapshot(env.DB, snap);
    const loaded = await loadLatestSnapshot(env.DB, 'prod');
    expect(loaded).not.toBeNull();
    expect(loaded!.ts).toBe(1000);
    expect(loaded!.status).toBe('operational');
    expect(loaded!.exchange.exchange_active).toBe(true);
  });

  it('returns null when no snapshot exists for environment', async () => {
    const loaded = await loadLatestSnapshot(env.DB, 'demo');
    expect(loaded).toBeNull();
  });

  it('returns the most recent snapshot when multiple exist', async () => {
    await saveSnapshot(env.DB, makeSnapshot('prod', 2000));
    await saveSnapshot(env.DB, makeSnapshot('prod', 3000));
    await saveSnapshot(env.DB, makeSnapshot('prod', 1500));
    const loaded = await loadLatestSnapshot(env.DB, 'prod');
    expect(loaded!.ts).toBe(3000);
  });

  it('isolates prod and demo snapshots', async () => {
    await saveSnapshot(env.DB, makeSnapshot('prod', 5000));
    await saveSnapshot(env.DB, makeSnapshot('demo', 6000));
    const prod = await loadLatestSnapshot(env.DB, 'prod');
    const demo = await loadLatestSnapshot(env.DB, 'demo');
    expect(prod!.ts).toBe(5000);
    expect(demo!.ts).toBe(6000);
  });
});

describe('pruneSnapshots', () => {
  it('removes snapshots older than the retention threshold', async () => {
    const now = Date.now();
    const old = now - 91 * 24 * 60 * 60 * 1000;
    const recent = now - 1000;
    await saveSnapshot(env.DB, makeSnapshot('prod', old));
    await saveSnapshot(env.DB, makeSnapshot('prod', recent));
    await pruneSnapshots(env.DB, now, 90);
    const loaded = await loadLatestSnapshot(env.DB, 'prod');
    expect(loaded!.ts).toBe(recent);
  });

  it('keeps snapshots within retention window', async () => {
    const now = Date.now();
    const withinRetention = now - 30 * 24 * 60 * 60 * 1000;
    await saveSnapshot(env.DB, makeSnapshot('prod', withinRetention));
    await pruneSnapshots(env.DB, now, 90);
    const loaded = await loadLatestSnapshot(env.DB, 'prod');
    expect(loaded).not.toBeNull();
  });
});

function makeRegionProbe(region: RegionProbe['region'], probed_at: number): RegionProbe {
  return { region, probed_at, endpoints: [] };
}

describe('saveRegionProbe / loadRecentRegionProbes', () => {
  it('saves a region probe and retrieves it', async () => {
    const probe = makeRegionProbe('us-east', 1000);
    await saveRegionProbe(env.DB, 'prod', probe);
    const probes = await loadRecentRegionProbes(env.DB, 'prod', 0);
    expect(probes).toHaveLength(1);
    expect(probes[0].region).toBe('us-east');
    expect(probes[0].probed_at).toBe(1000);
  });

  it('upserts: a second save for the same region replaces the first', async () => {
    await saveRegionProbe(env.DB, 'prod', makeRegionProbe('eu-west', 1000));
    await saveRegionProbe(env.DB, 'prod', makeRegionProbe('eu-west', 2000));
    const probes = await loadRecentRegionProbes(env.DB, 'prod', 0);
    expect(probes).toHaveLength(1);
    expect(probes[0].probed_at).toBe(2000);
  });

  it('filters by sinceMs', async () => {
    await saveRegionProbe(env.DB, 'prod', makeRegionProbe('us-east', 500));
    await saveRegionProbe(env.DB, 'prod', makeRegionProbe('eu-west', 1500));
    const probes = await loadRecentRegionProbes(env.DB, 'prod', 1000);
    expect(probes).toHaveLength(1);
    expect(probes[0].region).toBe('eu-west');
  });

  it('isolates prod and demo', async () => {
    await saveRegionProbe(env.DB, 'prod', makeRegionProbe('us-east', 1000));
    await saveRegionProbe(env.DB, 'demo', makeRegionProbe('asia', 1000));
    const prodProbes = await loadRecentRegionProbes(env.DB, 'prod', 0);
    const demoProbes = await loadRecentRegionProbes(env.DB, 'demo', 0);
    expect(prodProbes).toHaveLength(1);
    expect(prodProbes[0].region).toBe('us-east');
    expect(demoProbes).toHaveLength(1);
    expect(demoProbes[0].region).toBe('asia');
  });

  it('returns empty array when no probes match', async () => {
    const probes = await loadRecentRegionProbes(env.DB, 'prod', Date.now());
    expect(probes).toHaveLength(0);
  });
});
