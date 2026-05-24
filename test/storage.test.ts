import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { saveSnapshot, loadLatestSnapshot, pruneSnapshots } from '../src/storage';
import type { Snapshot } from '../src/types';

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

beforeEach(async () => {
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS snapshots (ts INTEGER NOT NULL, environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')), payload TEXT NOT NULL, PRIMARY KEY (environment, ts))`,
  );
  await env.DB.prepare('DELETE FROM snapshots').run();
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
