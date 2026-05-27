import { describe, it, expect, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';

const SCHEMA = `CREATE TABLE IF NOT EXISTS snapshots (ts INTEGER PRIMARY KEY, status TEXT NOT NULL, exchange_active INTEGER NOT NULL, trading_active INTEGER NOT NULL, endpoints TEXT NOT NULL)`;

async function call(path: string): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://kalshistatus.dev${path}`), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeEach(async () => {
  await env.DB.exec(SCHEMA);
  await env.DB.prepare('DELETE FROM snapshots').run();
});

describe('worker.fetch', () => {
  it('serves /healthz with ok:true and HSTS', async () => {
    const res = await call('/healthz');
    expect(res.status).toBe(200);
    expect((await res.json() as { ok: boolean }).ok).toBe(true);
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
  });

  it('routes /api/status to a 404 no_data before any probe', async () => {
    const res = await call('/api/status');
    expect(res.status).toBe(404);
  });

  it('applies a long-lived HSTS header to API responses', async () => {
    const res = await call('/api/status');
    expect(res.headers.get('Strict-Transport-Security')).toContain('includeSubDomains');
  });
});
