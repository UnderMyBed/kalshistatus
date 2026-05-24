import type { EndpointProbe, ExchangeStatus, OverallStatus } from './types';

export function determineStatus(probes: EndpointProbe[]): OverallStatus {
  const publicProbes = probes.filter((p) => !p.requires_auth);
  if (publicProbes.length === 0) return 'unknown';

  const exchangeProbe = publicProbes.find((p) => p.name === 'exchange_status');
  if (exchangeProbe && exchangeProbe.status !== 'up') return 'major_outage';

  const nonOpCount = publicProbes.filter((p) => p.status !== 'up').length;
  const ratio = nonOpCount / publicProbes.length;

  if (ratio === 1) return 'major_outage';
  if (ratio > 0.5) return 'partial_outage';
  if (nonOpCount > 0) return 'degraded';
  return 'operational';
}

export function exchangeStatusFromBody(body: unknown): ExchangeStatus {
  const fallback: ExchangeStatus = { exchange_active: false, trading_active: false };
  if (typeof body !== 'object' || body === null) return fallback;
  const b = body as { exchange_active?: unknown; trading_active?: unknown };
  return {
    exchange_active: b.exchange_active === true,
    trading_active: b.trading_active === true,
  };
}
