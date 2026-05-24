import { describe, expect, it, vi } from 'vitest';
import { ageFromData, sampleWebSocket } from '../src/ws-sampler';

const FAKE_PEM = 'pem-placeholder';

const fakeAuth = async (method: string, path: string) => ({
  'KALSHI-ACCESS-KEY': 'key',
  'KALSHI-ACCESS-TIMESTAMP': '1700000000000',
  'KALSHI-ACCESS-SIGNATURE': `sig-${method}-${path}`,
});

describe('sampleWebSocket', () => {
  it('returns no_credentials without making any network call when keyId is missing', async () => {
    const fetchFn = vi.fn();
    const result = await sampleWebSocket({
      wsUrl: 'wss://example.com/ws',
      keyId: undefined,
      privatePem: FAKE_PEM,
      authBuilder: fakeAuth,
      sampleMs: 100,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result.connected).toBe(false);
    expect(result.error).toBe('no_credentials');
    expect(result.channels).toHaveLength(4);
    expect(result.channels.every((c) => c.msg_count === 0)).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns no_credentials when private key is missing', async () => {
    const result = await sampleWebSocket({
      wsUrl: 'wss://example.com/ws',
      keyId: 'key',
      privatePem: undefined,
      sampleMs: 100,
    });
    expect(result.error).toBe('no_credentials');
    expect(result.connected).toBe(false);
  });

  it('returns upgrade_failed_<status> when fetch response is not a 101', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }));
    const result = await sampleWebSocket({
      wsUrl: 'wss://example.com/ws',
      keyId: 'key',
      privatePem: FAKE_PEM,
      authBuilder: fakeAuth,
      sampleMs: 100,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result.connected).toBe(false);
    expect(result.error).toBe('upgrade_failed_401');
    expect(result.channels).toHaveLength(4);
  });

  it('surfaces the fetch error message when the upgrade throws', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('dns lookup failed'));
    const result = await sampleWebSocket({
      wsUrl: 'wss://example.com/ws',
      keyId: 'key',
      privatePem: FAKE_PEM,
      authBuilder: fakeAuth,
      sampleMs: 100,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result.connected).toBe(false);
    expect(result.error).toBe('dns lookup failed');
  });

  it('uses https:// (not wss://) and the pathname-only signed path when calling fetch', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 }));
    await sampleWebSocket({
      wsUrl: 'wss://api.example.com/trade-api/ws/v2?ignored=1',
      keyId: 'key',
      privatePem: FAKE_PEM,
      authBuilder: fakeAuth,
      sampleMs: 100,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://api.example.com/trade-api/ws/v2?ignored=1');
    const headers = init.headers as Record<string, string>;
    expect(headers.Upgrade).toBe('websocket');
    expect(headers['KALSHI-ACCESS-KEY']).toBe('key');
    expect(headers['KALSHI-ACCESS-TIMESTAMP']).toMatch(/^\d+$/);
    expect(headers['KALSHI-ACCESS-SIGNATURE']).toBeTruthy();
  });

  it('returns four channels in the well-known order even with no traffic', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('nope', { status: 502 }));
    const result = await sampleWebSocket({
      wsUrl: 'wss://example.com/ws',
      keyId: 'key',
      privatePem: FAKE_PEM,
      authBuilder: fakeAuth,
      sampleMs: 100,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result.channels.map((c) => c.channel)).toEqual([
      'trade',
      'ticker_v2',
      'orderbook_delta',
      'communications',
    ]);
  });
});

describe('ageFromData', () => {
  it('returns a sane ms duration for a Kalshi message with seconds-scale ts (2s ago)', () => {
    const tsSeconds = Math.floor(Date.now() / 1000) - 2;
    const data = JSON.stringify({ type: 'trade', msg: { ts: tsSeconds } });
    const age = ageFromData(data);
    expect(age).not.toBeNull();
    expect(age!).toBeGreaterThanOrEqual(1500);
    expect(age!).toBeLessThan(5000);
  });

  it('still works for ms-scale ts (defensive against a future Kalshi shape change)', () => {
    const tsMs = Date.now() - 2000;
    const data = JSON.stringify({ type: 'trade', msg: { ts: tsMs } });
    const age = ageFromData(data);
    expect(age).not.toBeNull();
    expect(age!).toBeGreaterThanOrEqual(1500);
    expect(age!).toBeLessThan(5000);
  });

  it('returns null when ts is missing or non-numeric', () => {
    expect(ageFromData(JSON.stringify({ type: 'trade', msg: {} }))).toBeNull();
    expect(ageFromData(JSON.stringify({ type: 'trade' }))).toBeNull();
    expect(ageFromData(JSON.stringify({ type: 'trade', msg: { ts: 'oops' } }))).toBeNull();
  });

  it('returns null for non-JSON or non-string input', () => {
    expect(ageFromData('not json')).toBeNull();
    expect(ageFromData(42)).toBeNull();
    expect(ageFromData(null)).toBeNull();
  });

  it('regression guard: ts=1777858333 (seconds, observed in prod 2026-05-24) yields <1 year, not 53 years', () => {
    const data = JSON.stringify({ type: 'trade', msg: { ts: 1777858333 } });
    const age = ageFromData(data);
    expect(age).not.toBeNull();
    expect(Math.abs(age!)).toBeLessThan(365 * 24 * 60 * 60 * 1000);
  });
});
