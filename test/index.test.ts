import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

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
