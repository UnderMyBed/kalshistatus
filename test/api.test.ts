import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { handleApiStatus, handleApiHistory, handleBadge, handleApiVersion } from '../src/api';
import { saveSnapshot } from '../src/storage';
import type { Snapshot } from '../src/types';

const SCHEMA = `CREATE TABLE IF NOT EXISTS snapshots (ts INTEGER PRIMARY KEY, status TEXT NOT NULL, exchange_active INTEGER NOT NULL, trading_active INTEGER NOT NULL, endpoints TEXT NOT NULL)`;

function snap(ts: number, status: Snapshot['status'], latency: number): Snapshot {
  return {
    ts,
    status,
    exchange: { exchange_active: true, trading_active: true },
    endpoints: [{ name: 'markets_list', url: 'https://x/markets', method: 'GET', latency_ms: latency, status: 'up', http_status: 200 }],
  };
}

beforeEach(async () => {
  await env.DB.exec(SCHEMA);
  await env.DB.prepare('DELETE FROM snapshots').run();
});

describe('handleApiStatus', () => {
  it('returns 404 no_data before the first probe', async () => {
    const res = await handleApiStatus(new Request('https://x/api/status'), env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no_data' });
  });

  it('returns the latest snapshot plus three uptime windows', async () => {
    await saveSnapshot(env.DB, snap(Date.now(), 'operational', 40));
    const res = await handleApiStatus(new Request('https://x/api/status'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; uptime: Record<string, { pct: number }> };
    expect(body.status).toBe('operational');
    expect(Object.keys(body.uptime).sort()).toEqual(['24h', '30d', '7d']);
    expect(body.uptime['24h'].pct).toBe(100);
  });
});

describe('handleApiHistory', () => {
  it('rejects an invalid window with 400', async () => {
    const res = await handleApiHistory(new Request('https://x/api/history?window=99y'), env);
    expect(res.status).toBe(400);
  });

  it('returns an average-latency series for the window', async () => {
    const now = Date.now();
    await saveSnapshot(env.DB, snap(now - 1000, 'operational', 100));
    await saveSnapshot(env.DB, snap(now - 500, 'operational', 200));
    const res = await handleApiHistory(new Request('https://x/api/history?window=24h'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { window: string; series: { ts: number; latency_ms: number }[] };
    expect(body.window).toBe('24h');
    expect(body.series).toHaveLength(2);
    expect(body.series[0].latency_ms).toBe(100);
  });

  it('downsamples to at most 300 points', async () => {
    const now = Date.now();
    const stmts = [];
    for (let i = 0; i < 900; i++) {
      stmts.push(
        env.DB.prepare(
          'INSERT INTO snapshots (ts, status, exchange_active, trading_active, endpoints) VALUES (?, ?, ?, ?, ?)',
        ).bind(now - (900 - i) * 1000, 'operational', 1, 1, JSON.stringify([{ name: 'm', url: 'u', method: 'GET', latency_ms: 10, status: 'up', http_status: 200 }])),
      );
    }
    await env.DB.batch(stmts);
    const res = await handleApiHistory(new Request('https://x/api/history?window=24h'), env);
    const body = (await res.json()) as { series: unknown[] };
    expect(body.series.length).toBeLessThanOrEqual(300);
    expect(body.series.length).toBeGreaterThan(0);
  });
});

describe('handleBadge', () => {
  it('renders an unknown badge before the first probe', async () => {
    const res = await handleBadge(new Request('https://x/badge.svg'), env);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    expect(await res.text()).toContain('unknown');
  });

  it('renders the latest status', async () => {
    await saveSnapshot(env.DB, snap(Date.now(), 'operational', 40));
    const res = await handleBadge(new Request('https://x/badge.svg'), env);
    expect(await res.text()).toContain('operational');
  });
});

describe('handleApiVersion', () => {
  it('returns version and commit from env', () => {
    const res = handleApiVersion(new Request('https://x/api/version'), env);
    expect(res.status).toBe(200);
  });
});
