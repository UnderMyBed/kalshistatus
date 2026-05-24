import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { runFastCron, runSlowCron } from '../src/cron';

function makeMockFetch(status = 200) {
  return vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ exchange_active: true, trading_active: true }), { status }),
    );
}

async function applySchema() {
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS snapshots (ts INTEGER NOT NULL, environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')), payload TEXT NOT NULL, PRIMARY KEY (environment, ts))`,
  );
}

describe('runFastCron', () => {
  beforeEach(async () => {
    await applySchema();
    await env.DB.prepare('DELETE FROM snapshots').run();
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
