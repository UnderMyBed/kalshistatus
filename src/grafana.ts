import type { Snapshot } from './types';

const STATUS_VALUES: Record<string, number> = {
  operational: 1,
  degraded: 0.5,
  partial_outage: 0.25,
  major_outage: 0,
  unknown: -1,
};

const ENDPOINT_STATUS_VALUES: Record<string, number> = {
  up: 1,
  degraded: 0.5,
  down: 0,
  unknown: -1,
};

export function buildPrometheusPayload(snapshot: Snapshot): string {
  const ts = snapshot.ts;
  const lines: string[] = [];

  const statusVal = STATUS_VALUES[snapshot.status] ?? -1;
  lines.push(`# HELP kalshi_status_up Overall Kalshi API status (1=operational, 0=outage)`);
  lines.push(`# TYPE kalshi_status_up gauge`);
  lines.push(`kalshi_status_up{environment="${snapshot.environment}"} ${statusVal} ${ts}`);

  lines.push(`# HELP kalshi_exchange_active Exchange active flag`);
  lines.push(`# TYPE kalshi_exchange_active gauge`);
  lines.push(
    `kalshi_exchange_active{environment="${snapshot.environment}"} ${snapshot.exchange.exchange_active ? 1 : 0} ${ts}`,
  );

  lines.push(`# HELP kalshi_trading_active Trading active flag`);
  lines.push(`# TYPE kalshi_trading_active gauge`);
  lines.push(
    `kalshi_trading_active{environment="${snapshot.environment}"} ${snapshot.exchange.trading_active ? 1 : 0} ${ts}`,
  );

  if (snapshot.endpoints.length > 0) {
    lines.push(`# HELP kalshi_endpoint_latency_ms Endpoint probe latency in milliseconds`);
    lines.push(`# TYPE kalshi_endpoint_latency_ms gauge`);
    lines.push(`# HELP kalshi_endpoint_up Endpoint up status (1=up, 0=down)`);
    lines.push(`# TYPE kalshi_endpoint_up gauge`);

    for (const ep of snapshot.endpoints) {
      const label = `environment="${snapshot.environment}",endpoint="${ep.name}"`;
      if (ep.latency_ms != null) {
        lines.push(`kalshi_endpoint_latency_ms{${label}} ${ep.latency_ms} ${ts}`);
      }
      const upVal = ENDPOINT_STATUS_VALUES[ep.status] ?? -1;
      lines.push(`kalshi_endpoint_up{${label}} ${upVal} ${ts}`);
    }
  }

  return lines.join('\n') + '\n';
}

export async function pushMetrics(
  snapshot: Snapshot,
  remoteWriteUrl: string,
  instanceId: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const payload = buildPrometheusPayload(snapshot);
  const credentials = btoa(`${instanceId}:${token}`);

  try {
    const res = await fetchFn(remoteWriteUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'text/plain',
      },
      body: payload,
    });
    if (!res.ok) {
      console.error(`grafana remote-write failed: ${res.status}`);
    }
  } catch (err) {
    console.error('grafana remote-write error:', err);
  }
}
