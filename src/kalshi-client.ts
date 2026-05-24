import type { EndpointProbe, EndpointStatus } from './types';

interface EndpointDef {
  name: string;
  url: string;
  method: string;
  requires_auth: boolean;
}

export async function buildAuthHeaders(
  method: string,
  path: string,
  keyId: string | undefined,
  privatePem: string | undefined,
): Promise<Record<string, string>> {
  if (!keyId || !privatePem) return {};
  const timestamp = Date.now().toString();
  const message = timestamp + method.toUpperCase() + path;
  const privateKey = await importPrivateKey(privatePem);
  const signature = await signMessage(privateKey, message);
  return {
    'KALSHI-ACCESS-KEY': keyId,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'KALSHI-ACCESS-SIGNATURE': signature,
  };
}

export function normalizePemBody(pem: string): string {
  return pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s/g, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = normalizePemBody(pem);
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSA-PSS', hash: 'SHA-256' }, false, [
    'sign',
  ]);
}

async function signMessage(key: CryptoKey, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const signature = await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, key, data);
  return btoa(new Uint8Array(signature).reduce((s, b) => s + String.fromCharCode(b), ''));
}

export interface ProbeOutcome {
  probe: EndpointProbe;
  body: unknown;
}

export async function probeEndpoint(
  def: EndpointDef,
  authHeaders: Record<string, string>,
  fetchFn: typeof fetch = fetch,
): Promise<ProbeOutcome> {
  const start = Date.now();
  try {
    const res = await fetchFn(def.url, {
      method: def.method,
      headers: { 'Content-Type': 'application/json', ...authHeaders },
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
        requires_auth: def.requires_auth,
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
        requires_auth: def.requires_auth,
        error: err instanceof Error ? err.message : String(err),
      },
      body: null,
    };
  }
}

export function getEndpointDefs(baseUrl: string): EndpointDef[] {
  return [
    {
      name: 'exchange_status',
      url: `${baseUrl}/exchange/status`,
      method: 'GET',
      requires_auth: false,
    },
    {
      name: 'markets_list',
      url: `${baseUrl}/markets?limit=1`,
      method: 'GET',
      requires_auth: false,
    },
    { name: 'events_list', url: `${baseUrl}/events?limit=1`, method: 'GET', requires_auth: false },
    { name: 'series_list', url: `${baseUrl}/series?limit=1`, method: 'GET', requires_auth: false },
    {
      name: 'portfolio_balance',
      url: `${baseUrl}/portfolio/balance`,
      method: 'GET',
      requires_auth: true,
    },
    {
      name: 'portfolio_positions',
      url: `${baseUrl}/portfolio/positions?limit=1`,
      method: 'GET',
      requires_auth: true,
    },
    {
      name: 'portfolio_orders',
      url: `${baseUrl}/portfolio/orders?status=resting&limit=1`,
      method: 'GET',
      requires_auth: true,
    },
    {
      name: 'portfolio_fills',
      url: `${baseUrl}/portfolio/fills?limit=1`,
      method: 'GET',
      requires_auth: true,
    },
  ];
}
