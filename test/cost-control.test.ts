import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { CostController } from '../src/cost-control';

beforeEach(async () => {
  await env.KALSHI_KV.delete('cost:daily_count');
});

describe('CostController', () => {
  it('allows requests below soft threshold', async () => {
    const cc = new CostController(env.KALSHI_KV);
    const result = await cc.check();
    expect(result.allow).toBe(true);
    expect(result.mode).toBe('normal');
  });

  it('enters shed mode above soft threshold', async () => {
    await env.KALSHI_KV.put(
      'cost:daily_count',
      JSON.stringify({ count: 81_000, day: new Date().toISOString().slice(0, 10) }),
    );
    const cc = new CostController(env.KALSHI_KV);
    const result = await cc.check();
    expect(result.mode).toBe('shed');
  });

  it('blocks requests above hard threshold', async () => {
    await env.KALSHI_KV.put(
      'cost:daily_count',
      JSON.stringify({ count: 96_000, day: new Date().toISOString().slice(0, 10) }),
    );
    const cc = new CostController(env.KALSHI_KV);
    const result = await cc.check();
    expect(result.allow).toBe(false);
    expect(result.mode).toBe('blocked');
  });

  it('resets counter on new UTC day', async () => {
    await env.KALSHI_KV.put(
      'cost:daily_count',
      JSON.stringify({ count: 96_000, day: '2020-01-01' }),
    );
    const cc = new CostController(env.KALSHI_KV);
    const result = await cc.check();
    expect(result.allow).toBe(true);
    expect(result.mode).toBe('normal');
  });
});
