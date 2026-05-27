import { describe, it, expect, vi } from 'vitest';
import { probeEndpoint, getEndpointDefs } from '../src/kalshi-client';

const JSON_HEADERS = { 'content-type': 'application/json' };

describe('probeEndpoint', () => {
  it('reports up with latency and parsed body on a 200 JSON response', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ exchange_active: true }), { status: 200, headers: JSON_HEADERS }));
    const { probe, body } = await probeEndpoint(
      { name: 'exchange_status', url: 'https://x/exchange/status', method: 'GET' },
      fetchFn,
    );
    expect(probe.status).toBe('up');
    expect(probe.http_status).toBe(200);
    expect(typeof probe.latency_ms).toBe('number');
    expect(body).toEqual({ exchange_active: true });
  });

  it('reports down on a 500 response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    const { probe, body } = await probeEndpoint(
      { name: 'markets_list', url: 'https://x/markets', method: 'GET' },
      fetchFn,
    );
    expect(probe.status).toBe('down');
    expect(probe.http_status).toBe(500);
    expect(body).toBeNull();
  });

  it('reports down with an error message on a network failure', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('boom'));
    const { probe } = await probeEndpoint(
      { name: 'events_list', url: 'https://x/events', method: 'GET' },
      fetchFn,
    );
    expect(probe.status).toBe('down');
    expect(probe.latency_ms).toBeNull();
    expect(probe.error).toBe('boom');
  });
});

describe('getEndpointDefs', () => {
  it('returns the four public endpoints with the base url applied', () => {
    const defs = getEndpointDefs('https://api.example/v2');
    expect(defs.map((d) => d.name)).toEqual([
      'exchange_status',
      'markets_list',
      'events_list',
      'series_list',
    ]);
    expect(defs[0].url).toBe('https://api.example/v2/exchange/status');
    expect(defs.every((d) => d.method === 'GET')).toBe(true);
  });
});
