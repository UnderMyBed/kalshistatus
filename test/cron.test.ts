import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { runFastCron, runSlowCron } from '../src/cron';

const TRACE_IAD = 'fl=1\ncolo=IAD\n';
const TRACE_LHR = 'fl=1\ncolo=LHR\n';
const TRACE_UNKNOWN = 'fl=1\ncolo=ZZZ\n';

function makeMockFetch(status = 200, traceBody = TRACE_UNKNOWN) {
  return vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('cdn-cgi/trace')) {
      return Promise.resolve(new Response(traceBody));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ exchange_active: true, trading_active: true }), { status }),
    );
  });
}

async function applySchema() {
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS snapshots (ts INTEGER NOT NULL, environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')), payload TEXT NOT NULL, PRIMARY KEY (environment, ts))`,
  );
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS region_probes (environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')), region TEXT NOT NULL CHECK (region IN ('us-east', 'eu-west', 'asia')), probed_at INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (environment, region, probed_at))`,
  );
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS uptime_metrics (environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')), window_hours INTEGER NOT NULL, computed_at INTEGER NOT NULL, ok_count INTEGER NOT NULL, total_count INTEGER NOT NULL, pct REAL NOT NULL, PRIMARY KEY (environment, window_hours))`,
  );
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS changelog_summaries (link TEXT PRIMARY KEY, pub_date_ts INTEGER NOT NULL, title TEXT NOT NULL, summary_ai TEXT NOT NULL, generated_at INTEGER NOT NULL)`,
  );
}

describe('runFastCron', () => {
  beforeEach(async () => {
    await applySchema();
    await env.DB.prepare('DELETE FROM snapshots').run();
    await env.DB.prepare('DELETE FROM region_probes').run();
  });

  it('probes all 8 endpoints and writes a prod snapshot to D1', async () => {
    const mockFetch = makeMockFetch(200);
    await runFastCron(env, mockFetch);
    const row = await env.DB.prepare(
      'SELECT payload FROM snapshots WHERE environment = ? ORDER BY ts DESC LIMIT 1',
    )
      .bind('prod')
      .first<{ payload: string }>();
    expect(row).not.toBeNull();
    const snap = JSON.parse(row!.payload);
    expect(snap.environment).toBe('prod');
    expect(snap.endpoints).toHaveLength(8);
  });

  it('writes a demo snapshot to D1', async () => {
    const mockFetch = makeMockFetch(200);
    await runFastCron(env, mockFetch);
    const row = await env.DB.prepare(
      'SELECT payload FROM snapshots WHERE environment = ? ORDER BY ts DESC LIMIT 1',
    )
      .bind('demo')
      .first<{ payload: string }>();
    expect(row).not.toBeNull();
    const snap = JSON.parse(row!.payload);
    expect(snap.environment).toBe('demo');
  });

  it('marks status as major_outage when all endpoints return 500', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    await runFastCron(env, mockFetch);
    const row = await env.DB.prepare(
      'SELECT payload FROM snapshots WHERE environment = ? ORDER BY ts DESC LIMIT 1',
    )
      .bind('prod')
      .first<{ payload: string }>();
    const snap = JSON.parse(row!.payload);
    expect(snap.status).toBe('major_outage');
  });

  it('saves a region probe when region is detected', async () => {
    const mockFetch = makeMockFetch(200, TRACE_IAD);
    await runFastCron(env, mockFetch);
    const row = await env.DB.prepare(
      'SELECT payload FROM region_probes WHERE environment = ? AND region = ?',
    )
      .bind('prod', 'us-east')
      .first<{ payload: string }>();
    expect(row).not.toBeNull();
    const probe = JSON.parse(row!.payload);
    expect(probe.region).toBe('us-east');
    expect(probe.endpoints).toHaveLength(8);
  });

  it('saves region probe for eu-west when colo is LHR', async () => {
    const mockFetch = makeMockFetch(200, TRACE_LHR);
    await runFastCron(env, mockFetch);
    const row = await env.DB.prepare(
      'SELECT payload FROM region_probes WHERE environment = ? AND region = ?',
    )
      .bind('prod', 'eu-west')
      .first<{ payload: string }>();
    expect(row).not.toBeNull();
  });

  it('does not save a region probe when colo is unknown', async () => {
    const mockFetch = makeMockFetch(200, TRACE_UNKNOWN);
    await runFastCron(env, mockFetch);
    const row = await env.DB.prepare('SELECT COUNT(*) as cnt FROM region_probes').first<{
      cnt: number;
    }>();
    expect(row!.cnt).toBe(0);
  });
});

describe('runSlowCron', () => {
  beforeEach(async () => {
    await applySchema();
    await env.DB.prepare('DELETE FROM snapshots').run();
  });

  it('prunes old snapshots from D1', async () => {
    const oldTs = Date.now() - 91 * 24 * 60 * 60 * 1000;
    await env.DB.prepare('INSERT INTO snapshots (ts, environment, payload) VALUES (?, ?, ?)')
      .bind(
        oldTs,
        'prod',
        JSON.stringify({
          ts: oldTs,
          environment: 'prod',
          status: 'operational',
          exchange: { exchange_active: true, trading_active: true },
          endpoints: [],
          regions: [],
        }),
      )
      .run();
    await runSlowCron(env);
    const row = await env.DB.prepare('SELECT COUNT(*) as cnt FROM snapshots WHERE environment = ?')
      .bind('prod')
      .first<{ cnt: number }>();
    expect(row!.cnt).toBe(0);
  });
});
