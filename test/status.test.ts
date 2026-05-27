import { describe, it, expect } from 'vitest';
import { determineStatus, exchangeStatusFromBody } from '../src/status';
import type { EndpointProbe } from '../src/types';

function probe(name: string, status: EndpointProbe['status']): EndpointProbe {
  return { name, url: `https://example.com/${name}`, method: 'GET', latency_ms: 10, status, http_status: 200 };
}

describe('determineStatus', () => {
  it('returns operational when all endpoints are up', () => {
    expect(
      determineStatus([probe('exchange_status', 'up'), probe('markets_list', 'up'), probe('events_list', 'up'), probe('series_list', 'up')]),
    ).toBe('operational');
  });

  it('returns unknown for no probes', () => {
    expect(determineStatus([])).toBe('unknown');
  });

  it('treats exchange_status not-up as major_outage regardless of others', () => {
    expect(
      determineStatus([probe('exchange_status', 'down'), probe('markets_list', 'up'), probe('events_list', 'up'), probe('series_list', 'up')]),
    ).toBe('major_outage');
  });

  it('returns major_outage when every probe is down', () => {
    expect(
      determineStatus([probe('exchange_status', 'down'), probe('markets_list', 'down'), probe('events_list', 'down'), probe('series_list', 'down')]),
    ).toBe('major_outage');
  });

  it('returns partial_outage when more than half (but not all) are down', () => {
    expect(
      determineStatus([probe('exchange_status', 'up'), probe('markets_list', 'down'), probe('events_list', 'down'), probe('series_list', 'down')]),
    ).toBe('partial_outage');
  });

  it('returns degraded when a minority are down', () => {
    expect(
      determineStatus([probe('exchange_status', 'up'), probe('markets_list', 'up'), probe('events_list', 'up'), probe('series_list', 'down')]),
    ).toBe('degraded');
  });
});

describe('exchangeStatusFromBody', () => {
  it('reads boolean flags from a parsed body', () => {
    expect(exchangeStatusFromBody({ exchange_active: true, trading_active: false })).toEqual({
      exchange_active: true,
      trading_active: false,
    });
  });

  it('returns false flags for null / non-object / non-boolean fields', () => {
    expect(exchangeStatusFromBody(null)).toEqual({ exchange_active: false, trading_active: false });
    expect(exchangeStatusFromBody({ exchange_active: 'yes' })).toEqual({ exchange_active: false, trading_active: false });
  });
});
