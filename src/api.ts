import type { Env, OverallStatus } from './types';
import { loadLatestSnapshot, readSnapshotsSince, computeUptime } from './storage';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
};

export const STATUS_COLORS: Record<OverallStatus, string> = {
  operational: '#22c55e',
  degraded: '#eab308',
  partial_outage: '#ef4444',
  major_outage: '#ef4444',
  unknown: '#71717a',
};

const WINDOW_MS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function isGetOrHead(req: Request): boolean {
  return req.method === 'GET' || req.method === 'HEAD';
}

function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const stride = Math.ceil(arr.length / max);
  return arr.filter((_, i) => i % stride === 0);
}

export async function handleApiStatus(request: Request, env: Env): Promise<Response> {
  if (!isGetOrHead(request)) return new Response('Method Not Allowed', { status: 405, headers: CORS });

  const snapshot = await loadLatestSnapshot(env.DB);
  if (!snapshot) return Response.json({ error: 'no_data' }, { status: 404, headers: CORS });

  const now = Date.now();
  const [u24, u7, u30] = await Promise.all([
    computeUptime(env.DB, now - WINDOW_MS['24h']),
    computeUptime(env.DB, now - WINDOW_MS['7d']),
    computeUptime(env.DB, now - WINDOW_MS['30d']),
  ]);

  return Response.json(
    { ...snapshot, uptime: { '24h': u24, '7d': u7, '30d': u30 } },
    { headers: { ...CORS, 'Cache-Control': 'public, max-age=60' } },
  );
}

export async function handleApiHistory(request: Request, env: Env): Promise<Response> {
  if (!isGetOrHead(request)) return new Response('Method Not Allowed', { status: 405, headers: CORS });

  const url = new URL(request.url);
  const window = url.searchParams.get('window') ?? '24h';
  const span = WINDOW_MS[window];
  if (!span) return Response.json({ error: 'invalid_window' }, { status: 400, headers: CORS });

  const snapshots = await readSnapshotsSince(env.DB, Date.now() - span);
  const points = snapshots.map((s) => {
    const latencies = s.endpoints
      .map((e) => e.latency_ms)
      .filter((l): l is number => l != null);
    const latency_ms = latencies.length
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null;
    return { ts: s.ts, latency_ms };
  });

  return Response.json(
    { window, series: downsample(points, 300) },
    { headers: { ...CORS, 'Cache-Control': 'public, max-age=300' } },
  );
}

export async function handleBadge(request: Request, env: Env): Promise<Response> {
  if (!isGetOrHead(request)) return new Response('Method Not Allowed', { status: 405, headers: CORS });

  const snapshot = await loadLatestSnapshot(env.DB);
  const status = (snapshot?.status ?? 'unknown') as OverallStatus;
  const color = STATUS_COLORS[status];
  const label = status.replace(/_/g, ' ');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="20" role="img" aria-label="kalshi: ${label}"><linearGradient id="g" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".1" stop-color="#aaa" stop-opacity=".1"/><stop offset=".9" stop-color="#000" stop-opacity=".3"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient><rect rx="3" width="140" height="20" fill="#555"/><rect rx="3" x="46" width="94" height="20" fill="${color}"/><rect rx="3" width="140" height="20" fill="url(#g)"/><g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11"><text x="23" y="15" fill="#010101" fill-opacity=".3">kalshi</text><text x="23" y="14">kalshi</text><text x="93" y="15" fill="#010101" fill-opacity=".3">${label}</text><text x="93" y="14">${label}</text></g></svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
      ...CORS,
    },
  });
}

export function handleApiVersion(request: Request, env: Env): Response {
  if (!isGetOrHead(request)) return new Response('Method Not Allowed', { status: 405, headers: CORS });
  return Response.json(
    { version: env.VERSION, commit: env.COMMIT_SHA },
    { headers: { ...CORS, 'Cache-Control': 'public, max-age=300' } },
  );
}
