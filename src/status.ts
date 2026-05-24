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

export async function extractExchangeStatus(
  probes: EndpointProbe[],
  exchangeStatusUrl: string,
  fetchFn: typeof fetch,
): Promise<ExchangeStatus> {
  const fallback: ExchangeStatus = { exchange_active: false, trading_active: false };
  const exchangeProbe = probes.find((p) => p.name === 'exchange_status');
  if (!exchangeProbe || exchangeProbe.status !== 'up') return fallback;

  try {
    const res = await fetchFn(exchangeStatusUrl);
    if (!res.ok) return fallback;
    const body = await res.json<{ exchange_active?: boolean; trading_active?: boolean }>();
    return {
      exchange_active: body.exchange_active === true,
      trading_active: body.trading_active === true,
    };
  } catch {
    return fallback;
  }
}
