import type { Env, Environment, ChangelogEntry, OverallStatus } from './types';
import { readLatestSnapshot } from './kv';
import { readSnapshotHistory, readSnapshotAt, loadRecentRegionProbes } from './storage';

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

function isGetOrHead(req: Request): boolean {
  return req.method === 'GET' || req.method === 'HEAD';
}

export function parseEnvironment(url: URL): Environment {
  return url.searchParams.get('env') === 'demo' ? 'demo' : 'prod';
}

function parseLimit(url: URL, defaultLimit: number, maxLimit: number): number {
  const raw = parseInt(url.searchParams.get('limit') ?? String(defaultLimit), 10);
  return Math.min(Number.isFinite(raw) && raw > 0 ? raw : defaultLimit, maxLimit);
}

export async function handleApiStatus(request: Request, env: Env): Promise<Response> {
  if (!isGetOrHead(request)) {
    return new Response('Method Not Allowed', { status: 405, headers: CORS });
  }
  const url = new URL(request.url);
  const environment = parseEnvironment(url);

  const atParam = url.searchParams.get('at');
  if (atParam !== null) {
    if (!/^\d+$/.test(atParam)) {
      return Response.json({ error: 'Invalid timestamp' }, { status: 400, headers: CORS });
    }
    const ts = parseInt(atParam, 10);
    const snapshot = await readSnapshotAt(env.DB, environment, ts);
    if (!snapshot) {
      return Response.json({ error: 'Snapshot not found' }, { status: 404, headers: CORS });
    }
    return Response.json(snapshot, {
      headers: { ...CORS, 'Cache-Control': 'public, max-age=300' },
    });
  }

  const snapshot = await readLatestSnapshot(env.KALSHI_KV, environment);
  if (!snapshot) {
    return Response.json({ error: 'no_data' }, { status: 404, headers: CORS });
  }

  const sinceMs = Date.now() - 60 * 60 * 1000;
  const regions = await loadRecentRegionProbes(env.DB, environment, sinceMs);

  return Response.json(
    { ...snapshot, regions },
    { headers: { ...CORS, 'Cache-Control': 'public, max-age=30' } },
  );
}

export async function handleApiHistory(request: Request, env: Env): Promise<Response> {
  if (!isGetOrHead(request)) {
    return new Response('Method Not Allowed', { status: 405, headers: CORS });
  }
  const url = new URL(request.url);
  const environment = parseEnvironment(url);
  const limit = parseLimit(url, 60, 1440);
  const snapshots = await readSnapshotHistory(env.DB, environment, limit);
  return Response.json(snapshots, {
    headers: { ...CORS, 'Cache-Control': 'public, max-age=60' },
  });
}

export async function handleBadge(request: Request, env: Env): Promise<Response> {
  if (!isGetOrHead(request)) {
    return new Response('Method Not Allowed', { status: 405, headers: CORS });
  }
  const environment = parseEnvironment(new URL(request.url));
  const snapshot = await readLatestSnapshot(env.KALSHI_KV, environment);
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

export async function handleApiChangelog(request: Request, env: Env): Promise<Response> {
  if (!isGetOrHead(request)) {
    return new Response('Method Not Allowed', { status: 405, headers: CORS });
  }
  const url = new URL(request.url);
  const limit = parseLimit(url, 20, 50);
  const { results } = await env.DB.prepare(
    'SELECT link, title, summary_ai, pub_date_ts FROM changelog_summaries ORDER BY pub_date_ts DESC LIMIT ?',
  )
    .bind(limit)
    .all<ChangelogEntry>();
  return Response.json(results, {
    headers: { ...CORS, 'Cache-Control': 'public, max-age=300' },
  });
}

export function handleApiVersion(request: Request, env: Env): Response {
  if (!isGetOrHead(request)) {
    return new Response('Method Not Allowed', { status: 405, headers: CORS });
  }
  return Response.json(
    { version: env.VERSION, commit: env.COMMIT_SHA },
    { headers: { ...CORS, 'Cache-Control': 'public, max-age=300' } },
  );
}

export function handleArchitectureRedirect(): Response {
  return Response.redirect(
    'https://github.com/UnderMyBed/kalshistatus/blob/main/docs/ARCHITECTURE.md',
    302,
  );
}
