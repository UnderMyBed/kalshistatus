import { describe, it, expect, beforeEach } from 'vitest';
import { SELF, env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import { saveSnapshot } from '../src/storage';
import { writeSnapshotIfChanged } from '../src/kv';
import type { Snapshot } from '../src/types';

const SCHEMA = `CREATE TABLE IF NOT EXISTS snapshots (ts INTEGER NOT NULL, environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')), payload TEXT NOT NULL, PRIMARY KEY (environment, ts))`;
const REGION_SCHEMA = `CREATE TABLE IF NOT EXISTS region_probes (environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')), region TEXT NOT NULL CHECK (region IN ('us-east', 'eu-west', 'asia')), probed_at INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (environment, region))`;

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
  await env.DB.exec(REGION_SCHEMA);
  await env.DB.prepare('DELETE FROM snapshots').run();
  await env.DB.prepare('DELETE FROM region_probes').run();
});

describe('worker entry point', () => {
  it('returns 200 on GET /healthz', async () => {
    const res = await SELF.fetch('https://example.com/healthz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns 404 for unknown routes', async () => {
    const res = await SELF.fetch('https://example.com/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('fetch handler — region probe from request cf.colo', () => {
  it('saves a us-east probe when request cf.colo is IAD', async () => {
    const snap = makeSnap();
    await saveSnapshot(env.DB, snap);
    await writeSnapshotIfChanged(env.KALSHI_KV, snap);

    const req = new Request('https://example.com/api/status?env=prod');
    Object.defineProperty(req, 'cf', { value: { colo: 'IAD' }, configurable: true });
    const ctx = createExecutionContext();
    await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const row = await env.DB.prepare(
      'SELECT payload FROM region_probes WHERE environment = ? AND region = ?',
    )
      .bind('prod', 'us-east')
      .first<{ payload: string }>();
    expect(row).not.toBeNull();
    const probe = JSON.parse(row!.payload);
    expect(probe.region).toBe('us-east');
  });

  it('saves an eu-west probe when request cf.colo is LHR', async () => {
    const snap = makeSnap();
    await saveSnapshot(env.DB, snap);
    await writeSnapshotIfChanged(env.KALSHI_KV, snap);

    const req = new Request('https://example.com/api/status?env=prod');
    Object.defineProperty(req, 'cf', { value: { colo: 'LHR' }, configurable: true });
    const ctx = createExecutionContext();
    await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const row = await env.DB.prepare(
      'SELECT payload FROM region_probes WHERE environment = ? AND region = ?',
    )
      .bind('prod', 'eu-west')
      .first<{ payload: string }>();
    expect(row).not.toBeNull();
  });

  it('does not save a probe when cf.colo is unknown', async () => {
    const snap = makeSnap();
    await saveSnapshot(env.DB, snap);
    await writeSnapshotIfChanged(env.KALSHI_KV, snap);

    const req = new Request('https://example.com/api/status?env=prod');
    Object.defineProperty(req, 'cf', { value: { colo: 'SFO' }, configurable: true });
    const ctx = createExecutionContext();
    await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const row = await env.DB.prepare('SELECT COUNT(*) as cnt FROM region_probes').first<{
      cnt: number;
    }>();
    expect(row!.cnt).toBe(0);
  });

  it('does not save a probe when cf is absent', async () => {
    const snap = makeSnap();
    await saveSnapshot(env.DB, snap);
    await writeSnapshotIfChanged(env.KALSHI_KV, snap);

    const ctx = createExecutionContext();
    await worker.fetch(new Request('https://example.com/api/status?env=prod'), env, ctx);
    await waitOnExecutionContext(ctx);

    const row = await env.DB.prepare('SELECT COUNT(*) as cnt FROM region_probes').first<{
      cnt: number;
    }>();
    expect(row!.cnt).toBe(0);
  });

  it('saves probe for demo environment when env=demo', async () => {
    const snap = makeSnap({ environment: 'demo' });
    await saveSnapshot(env.DB, snap);
    await writeSnapshotIfChanged(env.KALSHI_KV, snap);

    const req = new Request('https://example.com/api/status?env=demo');
    Object.defineProperty(req, 'cf', { value: { colo: 'IAD' }, configurable: true });
    const ctx = createExecutionContext();
    await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const row = await env.DB.prepare(
      'SELECT payload FROM region_probes WHERE environment = ? AND region = ?',
    )
      .bind('demo', 'us-east')
      .first<{ payload: string }>();
    expect(row).not.toBeNull();
  });

  it('preserves cron endpoint data when fetch-handler probe arrives for same region', async () => {
    const ep = {
      name: 'ep1',
      url: 'https://example.com',
      method: 'GET',
      latency_ms: 50,
      status: 'up',
      http_status: 200,
    };
    const cronProbe = { region: 'us-east' as const, probed_at: 1000, endpoints: [ep] };
    await env.DB.prepare(
      'INSERT INTO region_probes (environment, region, probed_at, payload) VALUES (?, ?, ?, ?)',
    )
      .bind('prod', 'us-east', cronProbe.probed_at, JSON.stringify(cronProbe))
      .run();

    const snap = makeSnap();
    await saveSnapshot(env.DB, snap);
    await writeSnapshotIfChanged(env.KALSHI_KV, snap);

    const tBefore = Date.now();
    const req = new Request('https://example.com/api/status?env=prod');
    Object.defineProperty(req, 'cf', { value: { colo: 'IAD' }, configurable: true });
    const ctx = createExecutionContext();
    await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const row = await env.DB.prepare(
      'SELECT payload FROM region_probes WHERE environment = ? AND region = ?',
    )
      .bind('prod', 'us-east')
      .first<{ payload: string }>();
    expect(row).not.toBeNull();
    const probe = JSON.parse(row!.payload);
    expect(probe.endpoints).toHaveLength(1);
    expect(probe.endpoints[0].name).toBe('ep1');
    expect(probe.probed_at).toBeGreaterThanOrEqual(tBefore);
  });
});
