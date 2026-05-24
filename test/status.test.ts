import { describe, it, expect } from 'vitest';
import { determineStatus, exchangeStatusFromBody } from '../src/status';
import type { EndpointProbe } from '../src/types';

function probe(
  name: string,
  status: 'up' | 'down' | 'degraded' | 'unknown',
  http_status = 200,
  requires_auth = false,
): EndpointProbe {
  return {
    name,
    url: `https://example.com/${name}`,
    method: 'GET',
    latency_ms: 10,
    status,
    http_status,
    requires_auth,
  };
}

describe('determineStatus', () => {
  it('returns operational when all endpoints are up', () => {
    const probes = Array.from({ length: 8 }, (_, i) => probe(`ep${i}`, 'up'));
    expect(determineStatus(probes)).toBe('operational');
  });

  it('returns major_outage when all public endpoints are down', () => {
    const probes = Array.from({ length: 8 }, (_, i) => probe(`ep${i}`, 'down'));
    expect(determineStatus(probes)).toBe('major_outage');
  });

  it('returns partial_outage when more than half of public probes are down', () => {
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

  it('returns unknown when no public probes are present', () => {
    expect(determineStatus([])).toBe('unknown');
    expect(determineStatus([probe('portfolio_balance', 'down', 401, true)])).toBe('unknown');
  });

  it('treats exchange_status down as major_outage regardless of others', () => {
    const probes = [
      probe('exchange_status', 'down'),
      probe('markets_list', 'up'),
      probe('events_list', 'up'),
      probe('series_list', 'up'),
    ];
    expect(determineStatus(probes)).toBe('major_outage');
  });

  it('treats exchange_status degraded as major_outage', () => {
    const probes = [
      probe('exchange_status', 'degraded'),
      probe('markets_list', 'up'),
      probe('events_list', 'up'),
      probe('series_list', 'up'),
    ];
    expect(determineStatus(probes)).toBe('major_outage');
  });

  it('ignores authenticated probes when computing headline', () => {
    const probes = [
      probe('exchange_status', 'up'),
      probe('markets_list', 'up'),
      probe('events_list', 'up'),
      probe('series_list', 'up'),
      probe('portfolio_balance', 'down', 401, true),
      probe('portfolio_positions', 'down', 401, true),
      probe('portfolio_orders', 'down', 401, true),
      probe('portfolio_fills', 'down', 401, true),
    ];
    expect(determineStatus(probes)).toBe('operational');
  });

  it('does not let an auth probe failure tip the headline to degraded', () => {
    const probes = [
      probe('exchange_status', 'up'),
      probe('markets_list', 'up'),
      probe('events_list', 'up'),
      probe('series_list', 'up'),
      probe('portfolio_balance', 'unknown', null as unknown as number, true),
    ];
    expect(determineStatus(probes)).toBe('operational');
  });
});

describe('exchangeStatusFromBody', () => {
  it('reads exchange_active and trading_active from a parsed body', () => {
    expect(exchangeStatusFromBody({ exchange_active: true, trading_active: true })).toEqual({
      exchange_active: true,
      trading_active: true,
    });
    expect(exchangeStatusFromBody({ exchange_active: false, trading_active: true })).toEqual({
      exchange_active: false,
      trading_active: true,
    });
  });

  it('returns false flags for null / non-object body', () => {
    expect(exchangeStatusFromBody(null)).toEqual({
      exchange_active: false,
      trading_active: false,
    });
    expect(exchangeStatusFromBody('nonsense')).toEqual({
      exchange_active: false,
      trading_active: false,
    });
  });

  it('returns false flags when fields are missing or non-boolean', () => {
    expect(exchangeStatusFromBody({})).toEqual({
      exchange_active: false,
      trading_active: false,
    });
    expect(exchangeStatusFromBody({ exchange_active: 'yes', trading_active: 1 })).toEqual({
      exchange_active: false,
      trading_active: false,
    });
  });
});
