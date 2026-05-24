import { describe, it, expect, beforeEach } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import type { Snapshot } from '../src/types';
import { saveSnapshot } from '../src/storage';
import { writeSnapshotIfChanged } from '../src/kv';

const SCHEMA = `CREATE TABLE IF NOT EXISTS snapshots (ts INTEGER NOT NULL, environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')), payload TEXT NOT NULL, PRIMARY KEY (environment, ts))`;

function makeSnap(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    ts: Date.now(),
    environment: 'prod',
    status: 'operational',
    exchange: { exchange_active: true, trading_active: true },
    endpoints: Array.from({ length: 8 }, (_, i) => ({
      name: `ep${i}`,
      url: 'https://example.com',
      method: 'GET',
      latency_ms: 50,
      status: 'up',
      http_status: 200,
    })),
    regions: [],
    ...overrides,
  };
}

beforeEach(async () => {
  await env.DB.exec(SCHEMA);
  await env.DB.prepare('DELETE FROM snapshots').run();
});

describe('GET /api/status', () => {
  it('returns 404 when no snapshot exists', async () => {
    const res = await SELF.fetch('https://example.com/api/status?env=prod');
    expect(res.status).toBe(404);
  });

  it('returns snapshot from KV when available', async () => {
    const snap = makeSnap();
    await saveSnapshot(env.DB, snap);
    await writeSnapshotIfChanged(env.KALSHI_KV, snap);
    const res = await SELF.fetch('https://example.com/api/status?env=prod');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Snapshot;
    expect(body.status).toBe('operational');
    expect(body.endpoints).toHaveLength(8);
  });

  it('defaults to env=prod when no query param', async () => {
    const snap = makeSnap();
    await saveSnapshot(env.DB, snap);
    await writeSnapshotIfChanged(env.KALSHI_KV, snap);
    const res = await SELF.fetch('https://example.com/api/status');
    expect(res.status).toBe(200);
  });

  it('returns demo snapshot when env=demo', async () => {
    const snap = makeSnap({ environment: 'demo' });
    await saveSnapshot(env.DB, snap);
    await writeSnapshotIfChanged(env.KALSHI_KV, snap);
    const res = await SELF.fetch('https://example.com/api/status?env=demo');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Snapshot;
    expect(body.environment).toBe('demo');
  });
});

describe('GET /api/history', () => {
  it('returns an array of snapshots ordered newest first', async () => {
    for (let i = 1; i <= 3; i++) {
      await saveSnapshot(env.DB, makeSnap({ ts: i * 1000 }));
    }
    const res = await SELF.fetch('https://example.com/api/history?env=prod&limit=3');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Snapshot[];
    expect(body).toHaveLength(3);
    expect(body[0].ts).toBeGreaterThan(body[1].ts);
  });

  it('respects the limit parameter', async () => {
    for (let i = 1; i <= 5; i++) {
      await saveSnapshot(env.DB, makeSnap({ ts: i * 1000 }));
    }
    const res = await SELF.fetch('https://example.com/api/history?env=prod&limit=2');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Snapshot[];
    expect(body).toHaveLength(2);
  });
});

describe('GET /badge.svg', () => {
  it('returns SVG content-type', async () => {
    const snap = makeSnap();
    await saveSnapshot(env.DB, snap);
    await writeSnapshotIfChanged(env.KALSHI_KV, snap);
    const res = await SELF.fetch('https://example.com/badge.svg?env=prod');
    expect(res.headers.get('content-type')).toContain('svg');
  });

  it('returns unknown status badge when no data', async () => {
    const res = await SELF.fetch('https://example.com/badge.svg?env=prod');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('unknown');
  });
});

describe('GET /api/status?at=', () => {
  it('returns snapshot closest to requested timestamp from D1', async () => {
    const ts = 1_700_000_000_000;
    const snap = makeSnap({ ts });
    await saveSnapshot(env.DB, snap);
    const res = await SELF.fetch(`https://example.com/api/status?env=prod&at=${ts}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Snapshot;
    expect(body.ts).toBe(ts);
  });

  it('returns 404 when no snapshot within 5 min of requested ts', async () => {
    const ts = 1_700_000_000_000;
    await saveSnapshot(env.DB, makeSnap({ ts }));
    const farTs = ts + 10 * 60 * 1000;
    const res = await SELF.fetch(`https://example.com/api/status?env=prod&at=${farTs}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Snapshot not found');
  });
});

describe('OPTIONS preflight', () => {
  it('returns 204 with CORS header', async () => {
    const res = await SELF.fetch('https://example.com/api/status', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
