import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { runProbe, runPrune } from '../src/cron';

const SCHEMA = `CREATE TABLE IF NOT EXISTS snapshots (ts INTEGER PRIMARY KEY, status TEXT NOT NULL, exchange_active INTEGER NOT NULL, trading_active INTEGER NOT NULL, endpoints TEXT NOT NULL)`;

beforeEach(async () => {
  await env.DB.exec(SCHEMA);
  await env.DB.prepare('DELETE FROM snapshots').run();
});

function okFetch(status = 200) {
  return vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ exchange_active: true, trading_active: true }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

describe('runProbe', () => {
  it('probes the four public endpoints and writes one operational snapshot', async () => {
    await runProbe(env, okFetch(200));
    const row = await env.DB.prepare('SELECT * FROM snapshots ORDER BY ts DESC LIMIT 1').first<{
      status: string;
      endpoints: string;
      exchange_active: number;
    }>();
    expect(row).not.toBeNull();
    expect(row!.status).toBe('operational');
    expect(row!.exchange_active).toBe(1);
    expect(JSON.parse(row!.endpoints)).toHaveLength(4);
  });

  it('writes major_outage when every endpoint returns 500', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    await runProbe(env, fetchFn);
    const row = await env.DB.prepare('SELECT status FROM snapshots ORDER BY ts DESC LIMIT 1').first<{ status: string }>();
    expect(row!.status).toBe('major_outage');
  });
});

describe('runPrune', () => {
  it('deletes rows older than the retention window', async () => {
    const oldTs = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await env.DB.prepare(
      'INSERT INTO snapshots (ts, status, exchange_active, trading_active, endpoints) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(oldTs, 'operational', 1, 1, '[]')
      .run();
    await runPrune(env);
    const row = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM snapshots').first<{ cnt: number }>();
    expect(row!.cnt).toBe(0);
  });
});
