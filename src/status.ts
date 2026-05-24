import type { EndpointProbe, ExchangeStatus, OverallStatus } from './types';

export function determineStatus(probes: EndpointProbe[]): OverallStatus {
  if (probes.length === 0) return 'unknown';

  const exchangeProbe = probes.find((p) => p.name === 'exchange_status');
  if (exchangeProbe?.status === 'down') return 'major_outage';

  const downCount = probes.filter((p) => p.status === 'down').length;
  const ratio = downCount / probes.length;

  if (ratio === 1) return 'major_outage';
  if (ratio > 0.5) return 'partial_outage';
  if (downCount > 0) return 'degraded';
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
    const body = await res.json<{ exchange_active?: boolean; trading_active?: boolean }>();
    return {
      exchange_active: body.exchange_active === true,
      trading_active: body.trading_active === true,
    };
  } catch {
    return fallback;
  }
}
