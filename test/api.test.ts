import { describe, it, expect, beforeEach } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import type { Snapshot, RegionProbe } from '../src/types';
import { saveSnapshot, saveRegionProbe } from '../src/storage';
import { writeSnapshotIfChanged } from '../src/kv';

const SCHEMA = `CREATE TABLE IF NOT EXISTS snapshots (ts INTEGER NOT NULL, environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')), payload TEXT NOT NULL, PRIMARY KEY (environment, ts))`;
const REGION_SCHEMA = `CREATE TABLE IF NOT EXISTS region_probes (environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')), region TEXT NOT NULL CHECK (region IN ('us-east', 'eu-west', 'asia')), probed_at INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (environment, region, probed_at))`;
const UPTIME_SCHEMA = `CREATE TABLE IF NOT EXISTS uptime_metrics (environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')), window_hours INTEGER NOT NULL, computed_at INTEGER NOT NULL, ok_count INTEGER NOT NULL, total_count INTEGER NOT NULL, pct REAL NOT NULL, PRIMARY KEY (environment, window_hours))`;

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

const CACHEABLE_TEST_URLS = [
  'https://example.com/api/status?env=prod',
  'https://example.com/api/status?env=demo',
  'https://example.com/api/history?env=prod&limit=2',
  'https://example.com/api/history?env=prod&limit=3',
  'https://example.com/api/history?env=prod&limit=5',
  'https://example.com/badge.svg?env=prod',
  'https://example.com/api/changelog?limit=10',
  'https://example.com/api/version',
  'https://example.com/feed.xml',
];

beforeEach(async () => {
  await env.DB.exec(SCHEMA);
  await env.DB.exec(REGION_SCHEMA);
  await env.DB.exec(UPTIME_SCHEMA);
  await env.DB.prepare('DELETE FROM snapshots').run();
  await env.DB.prepare('DELETE FROM region_probes').run();
  await env.DB.prepare('DELETE FROM uptime_metrics').run();
  const list = await env.KALSHI_KV.list();
  for (const k of list.keys) await env.KALSHI_KV.delete(k.name);
  for (const u of CACHEABLE_TEST_URLS) {
    await caches.default.delete(new Request(u, { method: 'GET' }));
  }
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

  it('includes recent region probes in regions field', async () => {
    const snap = makeSnap();
    await saveSnapshot(env.DB, snap);
    await writeSnapshotIfChanged(env.KALSHI_KV, snap);
    const probe: RegionProbe = { region: 'us-east', probed_at: Date.now(), endpoints: [] };
    await saveRegionProbe(env.DB, 'prod', probe);
    const res = await SELF.fetch('https://example.com/api/status?env=prod');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Snapshot;
    expect(body.regions).toHaveLength(1);
    expect(body.regions[0].region).toBe('us-east');
  });

  it('collapses multiple probes per region to the most recent one', async () => {
    const snap = makeSnap();
    await saveSnapshot(env.DB, snap);
    await writeSnapshotIfChanged(env.KALSHI_KV, snap);
    const now = Date.now();
    await saveRegionProbe(env.DB, 'prod', {
      region: 'us-east',
      probed_at: now - 60_000,
      endpoints: [],
    });
    await saveRegionProbe(env.DB, 'prod', { region: 'us-east', probed_at: now, endpoints: [] });
    const res = await SELF.fetch('https://example.com/api/status?env=prod');
    const body = (await res.json()) as Snapshot;
    expect(body.regions).toHaveLength(1);
    expect(body.regions[0].probed_at).toBe(now);
  });

  it('excludes stale region probes older than 60 minutes', async () => {
    const snap = makeSnap();
    await saveSnapshot(env.DB, snap);
    await writeSnapshotIfChanged(env.KALSHI_KV, snap);
    const staleProbe: RegionProbe = {
      region: 'eu-west',
      probed_at: Date.now() - 61 * 60 * 1000,
      endpoints: [],
    };
    await saveRegionProbe(env.DB, 'prod', staleProbe);
    const res = await SELF.fetch('https://example.com/api/status?env=prod');
    const body = (await res.json()) as Snapshot;
    expect(body.regions).toHaveLength(0);
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

  it('uses the shared status palette (not a duplicate hex)', async () => {
    const snap = makeSnap();
    await saveSnapshot(env.DB, snap);
    await writeSnapshotIfChanged(env.KALSHI_KV, snap);
    const res = await SELF.fetch('https://example.com/badge.svg?env=prod');
    const body = await res.text();
    expect(body).toContain('#22c55e');
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

describe('GET /api/changelog', () => {
  it('returns recent summaries newest first', async () => {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS changelog_summaries (link TEXT PRIMARY KEY, pub_date_ts INTEGER NOT NULL, title TEXT NOT NULL, summary_ai TEXT NOT NULL, generated_at INTEGER NOT NULL)',
    );
    await env.DB.prepare('DELETE FROM changelog_summaries').run();
    for (let i = 1; i <= 3; i++) {
      await env.DB.prepare(
        'INSERT INTO changelog_summaries (link, pub_date_ts, title, summary_ai, generated_at) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(`https://kalshi.com/post/${i}`, i * 1000, `Post ${i}`, `Summary ${i}`, Date.now())
        .run();
    }
    const res = await SELF.fetch('https://example.com/api/changelog?limit=10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { link: string; pub_date_ts: number }[];
    expect(body).toHaveLength(3);
    expect(body[0].pub_date_ts).toBeGreaterThan(body[1].pub_date_ts);
  });
});

describe('GET /api/version', () => {
  it('returns version + commit from env', async () => {
    const res = await SELF.fetch('https://example.com/api/version');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string; commit: string };
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
  });
});

describe('GET /feed.xml', () => {
  it('returns RSS XML', async () => {
    const res = await SELF.fetch('https://example.com/feed.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('rss');
    const body = await res.text();
    expect(body).toContain('<rss version="2.0"');
    expect(body).toContain('<channel>');
  });
});

describe('GET /architecture', () => {
  it('redirects to GitHub docs', async () => {
    const res = await SELF.fetch('https://example.com/architecture', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain(
      'github.com/UnderMyBed/kalshistatus/blob/main/docs/ARCHITECTURE.md',
    );
  });
});

describe('HEAD support', () => {
  it('returns 200 with no body for HEAD on /api/status', async () => {
    const snap = makeSnap();
    await saveSnapshot(env.DB, snap);
    await writeSnapshotIfChanged(env.KALSHI_KV, snap);
    const res = await SELF.fetch('https://example.com/api/status?env=prod', { method: 'HEAD' });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe('');
  });
});

describe('OPTIONS preflight', () => {
  it('returns 204 with CORS header', async () => {
    const res = await SELF.fetch('https://example.com/api/status', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
