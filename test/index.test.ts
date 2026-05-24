import { describe, it, expect, beforeEach } from 'vitest';
import { SELF, env } from 'cloudflare:test';

const SCHEMA = `CREATE TABLE IF NOT EXISTS snapshots (ts INTEGER NOT NULL, environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')), payload TEXT NOT NULL, PRIMARY KEY (environment, ts))`;
const REGION_SCHEMA = `CREATE TABLE IF NOT EXISTS region_probes (environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')), region TEXT NOT NULL CHECK (region IN ('us-east', 'eu-west', 'asia')), probed_at INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (environment, region))`;

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

  it('applies security headers on /', async () => {
    const res = await SELF.fetch('https://example.com/');
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });

  it('allows /embed to be framed', async () => {
    const res = await SELF.fetch('https://example.com/embed');
    expect(res.headers.get('X-Frame-Options')).toBeNull();
    expect(res.headers.get('Content-Security-Policy')).toContain('frame-ancestors *');
  });

  it('returns 204 on OPTIONS preflight', async () => {
    const res = await SELF.fetch('https://example.com/api/status', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('HEAD');
  });
});
