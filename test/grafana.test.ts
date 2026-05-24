import { describe, it, expect, vi } from 'vitest';
import { buildPrometheusPayload, pushMetrics } from '../src/grafana';
import type { Snapshot } from '../src/types';

const snap: Snapshot = {
  ts: 1_000_000,
  environment: 'prod',
  status: 'operational',
  exchange: { exchange_active: true, trading_active: true },
  endpoints: [
    {
      name: 'exchange_status',
      url: '',
      method: 'GET',
      latency_ms: 42,
      status: 'up',
      http_status: 200,
    },
  ],
  regions: [],
};

describe('buildPrometheusPayload', () => {
  it('produces valid Prometheus text format with endpoint latency', () => {
    const payload = buildPrometheusPayload(snap);
    expect(payload).toContain('kalshi_endpoint_latency_ms');
    expect(payload).toContain('exchange_status');
    expect(payload).toContain('42');
  });

  it('includes overall status metric', () => {
    const payload = buildPrometheusPayload(snap);
    expect(payload).toContain('kalshi_status_up');
  });

  it('encodes endpoint status correctly (up=1)', () => {
    const payload = buildPrometheusPayload(snap);
    expect(payload).toContain('kalshi_endpoint_up');
  });

  it('handles multiple endpoints', () => {
    const multiSnap: Snapshot = {
      ...snap,
      endpoints: [
        { name: 'exchange_status', url: '', method: 'GET', latency_ms: 42, status: 'up', http_status: 200 },
        { name: 'markets', url: '', method: 'GET', latency_ms: 130, status: 'up', http_status: 200 },
      ],
    };
    const payload = buildPrometheusPayload(multiSnap);
    expect(payload).toContain('exchange_status');
    expect(payload).toContain('markets');
    expect(payload).toContain('130');
  });
});

describe('pushMetrics', () => {
  it('calls the Prometheus remote_write URL with basic auth', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('', { status: 204 }));
    await pushMetrics(snap, 'https://example.com/prom/push', '2964496', 'token123', mockFetch);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://example.com/prom/push');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Authorization']).toMatch(/^Basic /);
    expect(opts.headers['Content-Type']).toBe('text/plain');
  });

  it('encodes credentials as base64', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('', { status: 204 }));
    await pushMetrics(snap, 'https://example.com/prom/push', 'myInstance', 'myToken', mockFetch);
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    const encoded = opts.headers['Authorization'].replace('Basic ', '');
    expect(atob(encoded)).toBe('myInstance:myToken');
  });

  it('sends the Prometheus payload as body', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('', { status: 204 }));
    await pushMetrics(snap, 'https://example.com/prom/push', 'id', 'tok', mockFetch);
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(typeof opts.body).toBe('string');
    expect(opts.body as string).toContain('kalshi_endpoint_latency_ms');
  });

  it('does not throw on non-2xx response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('error', { status: 500 }));
    await expect(
      pushMetrics(snap, 'https://example.com/prom/push', 'id', 'tok', mockFetch),
    ).resolves.not.toThrow();
  });
});
