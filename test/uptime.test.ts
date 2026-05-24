import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { computeAndStoreUptime, readUptimeMetrics } from '../src/uptime';
import { saveSnapshot } from '../src/storage';
import type { Snapshot, OverallStatus } from '../src/types';

const SNAPSHOTS_SCHEMA = `CREATE TABLE IF NOT EXISTS snapshots (ts INTEGER NOT NULL, environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')), payload TEXT NOT NULL, PRIMARY KEY (environment, ts))`;
const UPTIME_SCHEMA = `CREATE TABLE IF NOT EXISTS uptime_metrics (environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')), window_hours INTEGER NOT NULL, computed_at INTEGER NOT NULL, ok_count INTEGER NOT NULL, total_count INTEGER NOT NULL, pct REAL NOT NULL, PRIMARY KEY (environment, window_hours))`;

function snap(ts: number, status: OverallStatus, environment: 'prod' | 'demo' = 'prod'): Snapshot {
  return {
    ts,
    environment,
    status,
    exchange: { exchange_active: true, trading_active: true },
    endpoints: [],
    regions: [],
  };
}

beforeEach(async () => {
  await env.DB.exec(SNAPSHOTS_SCHEMA);
  await env.DB.exec(UPTIME_SCHEMA);
  await env.DB.prepare('DELETE FROM snapshots').run();
  await env.DB.prepare('DELETE FROM uptime_metrics').run();
});

describe('computeAndStoreUptime', () => {
  it('returns 100% when all snapshots in the window are operational', async () => {
    const now = 1_000_000_000_000;
    for (let i = 0; i < 24; i++) {
      await saveSnapshot(env.DB, snap(now - i * 60 * 1000, 'operational'));
    }
    await computeAndStoreUptime(env.DB, now);
    const m = await readUptimeMetrics(env.DB, 'prod');
    expect(m!.windows['24']!.pct).toBe(100);
    expect(m!.windows['24']!.ok_count).toBe(24);
    expect(m!.windows['24']!.total_count).toBe(24);
  });

  it('counts degraded as ok (uptime); major_outage as down', async () => {
    const now = 1_000_000_000_000;
    await saveSnapshot(env.DB, snap(now - 1000, 'operational'));
    await saveSnapshot(env.DB, snap(now - 2000, 'degraded'));
    await saveSnapshot(env.DB, snap(now - 3000, 'major_outage'));
    await saveSnapshot(env.DB, snap(now - 4000, 'partial_outage'));
    await saveSnapshot(env.DB, snap(now - 5000, 'unknown'));
    await computeAndStoreUptime(env.DB, now);
    const m = await readUptimeMetrics(env.DB, 'prod');
    expect(m!.windows['24']!.ok_count).toBe(2);
    expect(m!.windows['24']!.total_count).toBe(5);
    expect(m!.windows['24']!.pct).toBe(40);
  });

  it('isolates prod and demo', async () => {
    const now = 1_000_000_000_000;
    await saveSnapshot(env.DB, snap(now - 1000, 'operational', 'prod'));
    await saveSnapshot(env.DB, snap(now - 2000, 'major_outage', 'demo'));
    await computeAndStoreUptime(env.DB, now);
    const prod = await readUptimeMetrics(env.DB, 'prod');
    const demo = await readUptimeMetrics(env.DB, 'demo');
    expect(prod!.windows['24']!.pct).toBe(100);
    expect(demo!.windows['24']!.pct).toBe(0);
  });

  it('returns 0% when no snapshots exist in the window (total_count = 0)', async () => {
    const now = 1_000_000_000_000;
    await computeAndStoreUptime(env.DB, now);
    const m = await readUptimeMetrics(env.DB, 'prod');
    expect(m!.windows['24']!.total_count).toBe(0);
    expect(m!.windows['24']!.pct).toBe(0);
  });

  it('writes all three windows (24h, 7d, 30d)', async () => {
    const now = 1_000_000_000_000;
    await computeAndStoreUptime(env.DB, now);
    const m = await readUptimeMetrics(env.DB, 'prod');
    expect(Object.keys(m!.windows).sort()).toEqual(['168', '24', '720']);
  });
});

describe('readUptimeMetrics', () => {
  it('returns null when no metrics rows exist', async () => {
    const m = await readUptimeMetrics(env.DB, 'prod');
    expect(m).toBeNull();
  });
});
