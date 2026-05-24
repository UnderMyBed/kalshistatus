import { describe, it, expect } from 'vitest';
import { determineStatus, extractExchangeStatus } from '../src/status';
import type { EndpointProbe } from '../src/types';

function probe(
  name: string,
  status: 'up' | 'down' | 'degraded' | 'unknown',
  http_status = 200,
): EndpointProbe {
  return {
    name,
    url: `https://example.com/${name}`,
    method: 'GET',
    latency_ms: 10,
    status,
    http_status,
  };
}

describe('determineStatus', () => {
  it('returns operational when all endpoints are up', () => {
    const probes = Array.from({ length: 8 }, (_, i) => probe(`ep${i}`, 'up'));
    expect(determineStatus(probes)).toBe('operational');
  });

  it('returns major_outage when all endpoints are down', () => {
    const probes = Array.from({ length: 8 }, (_, i) => probe(`ep${i}`, 'down'));
    expect(determineStatus(probes)).toBe('major_outage');
  });

  it('returns partial_outage when more than half are down', () => {
    const probes = [
      probe('ep0', 'up'),
      probe('ep1', 'up'),
      probe('ep2', 'down'),
      probe('ep3', 'down'),
      probe('ep4', 'down'),
      probe('ep5', 'down'),
      probe('ep6', 'down'),
    ];
    expect(determineStatus(probes)).toBe('partial_outage');
  });

  it('returns degraded when a minority are down', () => {
    const probes = [
      probe('ep0', 'up'),
      probe('ep1', 'up'),
      probe('ep2', 'up'),
      probe('ep3', 'up'),
      probe('ep4', 'up'),
      probe('ep5', 'up'),
      probe('ep6', 'down'),
      probe('ep7', 'down'),
    ];
    expect(determineStatus(probes)).toBe('degraded');
  });

  it('returns unknown when probes array is empty', () => {
    expect(determineStatus([])).toBe('unknown');
  });

  it('treats exchange_status down as major_outage regardless of others', () => {
    const probes = [
      probe('exchange_status', 'down'),
      probe('ep1', 'up'),
      probe('ep2', 'up'),
      probe('ep3', 'up'),
      probe('ep4', 'up'),
      probe('ep5', 'up'),
      probe('ep6', 'up'),
      probe('ep7', 'up'),
    ];
    expect(determineStatus(probes)).toBe('major_outage');
  });

  it('treats exchange_status degraded as major_outage', () => {
    const probes = [
      probe('exchange_status', 'degraded'),
      ...Array.from({ length: 7 }, (_, i) => probe(`ep${i}`, 'up')),
    ];
    expect(determineStatus(probes)).toBe('major_outage');
  });

  it('counts degraded probes toward non-operational ratio', () => {
    const probes = [
      probe('ep0', 'up'),
      probe('ep1', 'degraded'),
      probe('ep2', 'degraded'),
      probe('ep3', 'unknown'),
      probe('ep4', 'degraded'),
      probe('ep5', 'degraded'),
    ];
    expect(determineStatus(probes)).toBe('partial_outage');
  });

  it('returns major_outage when all probes are degraded/unknown', () => {
    const probes = [probe('ep0', 'degraded'), probe('ep1', 'unknown'), probe('ep2', 'degraded')];
    expect(determineStatus(probes)).toBe('major_outage');
  });
});

describe('extractExchangeStatus', () => {
  it('returns active flags when body has them set to true', async () => {
    const mockFetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ exchange_active: true, trading_active: true }), {
          status: 200,
        }),
      );
    const probes = [probe('exchange_status', 'up')];
    const result = await extractExchangeStatus(
      probes,
      'https://api.example.com/exchange/status',
      mockFetch as typeof fetch,
    );
    expect(result.exchange_active).toBe(true);
    expect(result.trading_active).toBe(true);
  });

  it('returns false flags when exchange_status probe is down', async () => {
    const probes = [probe('exchange_status', 'down', 500)];
    const result = await extractExchangeStatus(
      probes,
      'https://api.example.com/exchange/status',
      fetch,
    );
    expect(result.exchange_active).toBe(false);
    expect(result.trading_active).toBe(false);
  });

  it('returns false flags when fetch returns non-2xx', async () => {
    const mockFetch = () => Promise.resolve(new Response('Service Unavailable', { status: 503 }));
    const probes = [probe('exchange_status', 'up')];
    const result = await extractExchangeStatus(
      probes,
      'https://api.example.com/exchange/status',
      mockFetch as typeof fetch,
    );
    expect(result.exchange_active).toBe(false);
    expect(result.trading_active).toBe(false);
  });

  it('returns false flags when body parse fails', async () => {
    const mockFetch = () => Promise.resolve(new Response('not-json', { status: 200 }));
    const probes = [probe('exchange_status', 'up')];
    const result = await extractExchangeStatus(
      probes,
      'https://api.example.com/exchange/status',
      mockFetch as typeof fetch,
    );
    expect(result.exchange_active).toBe(false);
    expect(result.trading_active).toBe(false);
  });

  it('returns false flags when exchange_status probe is missing', async () => {
    const result = await extractExchangeStatus(
      [],
      'https://api.example.com/exchange/status',
      fetch,
    );
    expect(result.exchange_active).toBe(false);
    expect(result.trading_active).toBe(false);
  });
});
