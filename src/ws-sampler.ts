import { buildAuthHeaders } from './kalshi-client';
import type { WsChannelName, WsChannelSample, WsSample } from './types';

const CHANNELS: readonly WsChannelName[] = [
  'trade',
  'ticker_v2',
  'orderbook_delta',
  'communications',
] as const;

const UPGRADE_TIMEOUT_MS = 10_000;

export type AuthHeaderBuilder = (method: string, path: string) => Promise<Record<string, string>>;

export interface WsSampleParams {
  wsUrl: string;
  keyId: string | undefined;
  privatePem: string | undefined;
  sampleMs: number;
  fetchFn?: typeof fetch;
  authBuilder?: AuthHeaderBuilder;
}

export async function sampleWebSocket(params: WsSampleParams): Promise<WsSample> {
  const { wsUrl, keyId, privatePem, sampleMs, fetchFn = fetch } = params;
  const sampledAt = Date.now();
  const base = emptySample(sampledAt, sampleMs);

  if (!keyId || !privatePem) {
    return { ...base, error: 'no_credentials' };
  }

  const authBuilder: AuthHeaderBuilder =
    params.authBuilder ?? ((method, path) => buildAuthHeaders(method, path, keyId, privatePem));

  const parsed = new URL(wsUrl);
  const httpUrl = `https://${parsed.host}${parsed.pathname}${parsed.search}`;
  const signedPath = parsed.pathname;

  const handshakeStart = Date.now();
  let resp: Response;
  try {
    const authHeaders = await authBuilder('GET', signedPath);
    resp = await fetchFn(httpUrl, {
      headers: { Upgrade: 'websocket', ...authHeaders },
      signal: AbortSignal.timeout(UPGRADE_TIMEOUT_MS),
    });
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }

  if (resp.status !== 101 || !resp.webSocket) {
    return { ...base, error: `upgrade_failed_${resp.status}` };
  }

  const ws = resp.webSocket;
  ws.accept();
  const handshakeMs = Date.now() - handshakeStart;

  const counts: Record<WsChannelName, number> = {
    trade: 0,
    ticker_v2: 0,
    orderbook_delta: 0,
    communications: 0,
  };
  const ages: Record<WsChannelName, number[]> = {
    trade: [],
    ticker_v2: [],
    orderbook_delta: [],
    communications: [],
  };

  for (let i = 0; i < CHANNELS.length; i++) {
    ws.send(JSON.stringify({ id: i + 1, cmd: 'subscribe', params: { channels: [CHANNELS[i]] } }));
  }

  return new Promise<WsSample>((resolve) => {
    let settled = false;
    let closeError: string | undefined;
    const stopTimer = setTimeout(() => settle(), sampleMs);

    ws.addEventListener('message', (event: MessageEvent) => {
      const channel = classifyMessage(event.data);
      if (channel === null) return;
      counts[channel]++;
      const age = ageFromData(event.data);
      if (age !== null) ages[channel].push(age);
    });

    ws.addEventListener('close', () => settle());
    ws.addEventListener('error', () => {
      closeError = 'ws_error';
      settle();
    });

    function settle(): void {
      if (settled) return;
      settled = true;
      clearTimeout(stopTimer);
      try {
        ws.close(1000, 'sample complete');
      } catch {
        // already closed
      }
      const sample: WsSample = {
        connected: true,
        handshake_ms: handshakeMs,
        sample_ms: sampleMs,
        sampled_at: sampledAt,
        channels: CHANNELS.map<WsChannelSample>((c) => ({
          channel: c,
          msg_count: counts[c],
          rate_per_sec: round2(counts[c] / (sampleMs / 1000)),
          median_age_ms: median(ages[c]),
        })),
      };
      resolve(closeError ? { ...sample, error: closeError } : sample);
    }
  });
}

function emptySample(sampledAt: number, sampleMs: number): WsSample {
  return {
    connected: false,
    handshake_ms: null,
    sample_ms: sampleMs,
    sampled_at: sampledAt,
    channels: CHANNELS.map<WsChannelSample>((c) => ({
      channel: c,
      msg_count: 0,
      rate_per_sec: 0,
      median_age_ms: null,
    })),
  };
}

function classifyMessage(data: unknown): WsChannelName | null {
  const msg = parseMessage(data);
  if (!msg) return null;
  const type = msg.type;
  if (type === 'trade') return 'trade';
  if (type === 'ticker_v2' || type === 'ticker') return 'ticker_v2';
  if (type === 'orderbook_delta' || type === 'orderbook_snapshot') return 'orderbook_delta';
  if (type === 'communications') return 'communications';
  return null;
}

export function ageFromData(data: unknown): number | null {
  const msg = parseMessage(data);
  const ts = msg?.msg?.ts;
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null;
  const tsMs = ts < 1e12 ? ts * 1000 : ts;
  return Date.now() - tsMs;
}

function parseMessage(data: unknown): { type?: string; msg?: { ts?: number } } | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed = JSON.parse(data);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const raw = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(raw);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
