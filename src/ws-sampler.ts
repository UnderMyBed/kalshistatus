import type { WsSample } from './types';

export async function sampleWebSocket(wsUrl: string, sampleMs: number): Promise<WsSample> {
  const start = Date.now();
  return new Promise((resolve) => {
    const hardTimeout = setTimeout(() => {
      resolve({
        connected: false,
        latency_ms: null,
        tickers_received: 0,
        sampled_at: Date.now(),
        error: 'timeout',
      });
    }, sampleMs + 5_000);

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      clearTimeout(hardTimeout);
      resolve({
        connected: false,
        latency_ms: null,
        tickers_received: 0,
        sampled_at: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    let tickers = 0;
    let connected = false;

    ws.addEventListener('open', () => {
      connected = true;
      ws.send(JSON.stringify({ id: 1, cmd: 'subscribe', params: { channels: ['ticker_v2'] } }));
    });

    ws.addEventListener('message', () => {
      tickers++;
    });

    ws.addEventListener('error', () => {
      clearTimeout(hardTimeout);
      ws.close();
      resolve({
        connected,
        latency_ms: null,
        tickers_received: tickers,
        sampled_at: Date.now(),
        error: 'websocket error',
      });
    });

    setTimeout(() => {
      clearTimeout(hardTimeout);
      const latency = connected ? Date.now() - start : null;
      ws.close();
      resolve({
        connected,
        latency_ms: latency,
        tickers_received: tickers,
        sampled_at: Date.now(),
      });
    }, sampleMs);
  });
}
