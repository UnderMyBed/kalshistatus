import type { WsSample } from './types';

export async function sampleWebSocket(wsUrl: string, sampleMs: number): Promise<WsSample> {
  return new Promise((resolve) => {
    let settled = false;
    let handshakeMs: number | null = null;
    let tickers = 0;
    let connected = false;
    let ws: WebSocket | undefined;
    let hardTimer: ReturnType<typeof setTimeout>;
    const start = Date.now();

    function settle(result: WsSample): void {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      try {
        ws?.close();
      } catch {
        // already closed
      }
      resolve(result);
    }

    hardTimer = setTimeout(() => {
      settle({
        connected: false,
        latency_ms: null,
        tickers_received: 0,
        sampled_at: Date.now(),
        error: 'timeout',
      });
    }, sampleMs + 5_000);

    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      settle({
        connected: false,
        latency_ms: null,
        tickers_received: 0,
        sampled_at: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    ws.addEventListener('open', () => {
      connected = true;
      handshakeMs = Date.now() - start;
      ws!.send(JSON.stringify({ id: 1, cmd: 'subscribe', params: { channels: ['ticker_v2'] } }));
    });

    ws.addEventListener('message', () => {
      tickers++;
    });

    ws.addEventListener('error', () => {
      settle({
        connected,
        latency_ms: null,
        tickers_received: tickers,
        sampled_at: Date.now(),
        error: 'websocket error',
      });
    });

    setTimeout(() => {
      settle({
        connected,
        latency_ms: handshakeMs,
        tickers_received: tickers,
        sampled_at: Date.now(),
      });
    }, sampleMs);
  });
}
