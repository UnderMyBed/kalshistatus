import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  saveSnapshot,
  loadLatestSnapshot,
  readSnapshotsSince,
  computeUptime,
  pruneSnapshots,
} from '../src/storage';
import type { Snapshot } from '../src/types';

const SCHEMA = `CREATE TABLE IF NOT EXISTS snapshots (ts INTEGER PRIMARY KEY, status TEXT NOT NULL, exchange_active INTEGER NOT NULL, trading_active INTEGER NOT NULL, endpoints TEXT NOT NULL)`;

function snap(ts: number, status: Snapshot['status'] = 'operational'): Snapshot {
  return {
    ts,
    status,
    exchange: { exchange_active: true, trading_active: true },
    endpoints: [
      {
        name: 'exchange_status',
        url: 'https://x/exchange/status',
        method: 'GET',
        latency_ms: 50,
        status: 'up',
        http_status: 200,
      },
    ],
  };
}

beforeEach(async () => {
  await env.DB.exec(SCHEMA);
  await env.DB.prepare('DELETE FROM snapshots').run();
});

describe('saveSnapshot / loadLatestSnapshot', () => {
  it('round-trips a snapshot', async () => {
    await saveSnapshot(env.DB, snap(1000));
    const loaded = await loadLatestSnapshot(env.DB);
    expect(loaded!.ts).toBe(1000);
    expect(loaded!.exchange.exchange_active).toBe(true);
    expect(loaded!.endpoints).toHaveLength(1);
    expect(loaded!.endpoints[0].latency_ms).toBe(50);
  });

  it('returns null when empty', async () => {
    expect(await loadLatestSnapshot(env.DB)).toBeNull();
  });

  it('returns the most recent by ts', async () => {
    await saveSnapshot(env.DB, snap(2000));
    await saveSnapshot(env.DB, snap(3000));
    await saveSnapshot(env.DB, snap(1500));
    expect((await loadLatestSnapshot(env.DB))!.ts).toBe(3000);
  });
});

describe('readSnapshotsSince', () => {
  it('returns rows at or after the cutoff, oldest first', async () => {
    await saveSnapshot(env.DB, snap(1000));
    await saveSnapshot(env.DB, snap(2000));
    await saveSnapshot(env.DB, snap(3000));
    const rows = await readSnapshotsSince(env.DB, 2000);
    expect(rows.map((r) => r.ts)).toEqual([2000, 3000]);
  });
});

describe('computeUptime', () => {
  it('counts operational and degraded as available, down/outage against', async () => {
    await saveSnapshot(env.DB, snap(1000, 'operational'));
    await saveSnapshot(env.DB, snap(2000, 'degraded'));
    await saveSnapshot(env.DB, snap(3000, 'major_outage'));
    await saveSnapshot(env.DB, snap(4000, 'partial_outage'));
    const u = await computeUptime(env.DB, 0);
    expect(u.total_count).toBe(4);
    expect(u.ok_count).toBe(2);
    expect(u.pct).toBe(50);
  });

  it('returns pct 0 with no rows', async () => {
    const u = await computeUptime(env.DB, 0);
    expect(u).toEqual({ total_count: 0, ok_count: 0, pct: 0 });
  });
});

describe('pruneSnapshots', () => {
  it('removes rows older than the retention window and keeps newer', async () => {
    const now = Date.now();
    await saveSnapshot(env.DB, snap(now - 31 * 24 * 60 * 60 * 1000));
    await saveSnapshot(env.DB, snap(now - 1000));
    await pruneSnapshots(env.DB, now, 30);
    const rows = await readSnapshotsSince(env.DB, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0].ts).toBe(now - 1000);
  });
});
