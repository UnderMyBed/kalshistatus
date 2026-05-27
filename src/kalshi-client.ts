import type { EndpointProbe, EndpointStatus } from './types';

interface EndpointDef {
  name: string;
  url: string;
  method: string;
}

export interface ProbeOutcome {
  probe: EndpointProbe;
  body: unknown;
}

export async function probeEndpoint(
  def: EndpointDef,
  fetchFn: typeof fetch = fetch,
): Promise<ProbeOutcome> {
  const start = Date.now();
  try {
    const res = await fetchFn(def.url, {
      method: def.method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    const latency_ms = Date.now() - start;
    const status: EndpointStatus = res.ok ? 'up' : 'down';
    const contentType = res.headers.get('content-type') ?? '';
    const body = res.ok && contentType.includes('application/json') ? await res.json() : null;
    return {
      probe: {
        name: def.name,
        url: def.url,
        method: def.method,
        latency_ms,
        status,
        http_status: res.status,
      },
      body,
    };
  } catch (err) {
    return {
      probe: {
        name: def.name,
        url: def.url,
        method: def.method,
        latency_ms: null,
        status: 'down',
        http_status: null,
        error: err instanceof Error ? err.message : String(err),
      },
      body: null,
    };
  }
}

export function getEndpointDefs(baseUrl: string): EndpointDef[] {
  return [
    { name: 'exchange_status', url: `${baseUrl}/exchange/status`, method: 'GET' },
    { name: 'markets_list', url: `${baseUrl}/markets?limit=1`, method: 'GET' },
    { name: 'events_list', url: `${baseUrl}/events?limit=1`, method: 'GET' },
    { name: 'series_list', url: `${baseUrl}/series?limit=1`, method: 'GET' },
  ];
}
