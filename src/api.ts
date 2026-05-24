import type { Env } from './types';
import { readLatestSnapshot } from './kv';
import { readSnapshotHistory } from './storage';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function handleApiStatus(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const environment = (url.searchParams.get('env') ?? 'prod') as 'prod' | 'demo';

  const snapshot = await readLatestSnapshot(env.KALSHI_KV, environment);
  if (!snapshot) {
    return Response.json({ error: 'no_data' }, { status: 404, headers: CORS });
  }

  return Response.json(snapshot, {
    headers: {
      ...CORS,
      'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
    },
  });
}

export async function handleApiHistory(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const environment = (url.searchParams.get('env') ?? 'prod') as 'prod' | 'demo';
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '60', 10), 1440);

  const snapshots = await readSnapshotHistory(env.DB, environment, limit);
  return Response.json(snapshots, {
    headers: { ...CORS, 'Cache-Control': 'public, max-age=60' },
  });
}

const STATUS_COLORS: Record<string, string> = {
  operational: '#2ecc71',
  degraded: '#f39c12',
  partial_outage: '#e67e22',
  major_outage: '#e74c3c',
  unknown: '#95a5a6',
};

export async function handleBadge(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const environment = (url.searchParams.get('env') ?? 'prod') as 'prod' | 'demo';
  const snapshot = await readLatestSnapshot(env.KALSHI_KV, environment);
  const status = snapshot?.status ?? 'unknown';
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.unknown;
  const label = status.replace(/_/g, ' ');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="20"><rect width="50" height="20" fill="#555"/><rect x="50" width="70" height="20" fill="${color}"/><text x="25" y="14" font-family="sans-serif" font-size="11" fill="white" text-anchor="middle">kalshi</text><text x="85" y="14" font-family="sans-serif" font-size="11" fill="white" text-anchor="middle">${label}</text></svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
      ...CORS,
    },
  });
}
