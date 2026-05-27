import type { Env } from './types';
import { runProbe, runPrune } from './cron';
import { handleApiStatus, handleApiHistory, handleBadge, handleApiVersion } from './api';
import { buildCacheKey, readCache, writeCache, withCacheHit } from './edge-cache';

const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'accelerometer=(), camera=(), geolocation=(), microphone=()',
};

const FRAME_DENY_PATHS = new Set(['/', '/api/status', '/api/history', '/healthz']);
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function withSecurityHeaders(res: Response, pathname: string): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  if (FRAME_DENY_PATHS.has(pathname)) {
    headers.set('X-Frame-Options', 'DENY');
    headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'",
    );
  }
  const body = NULL_BODY_STATUSES.has(res.status) ? null : res.body;
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

async function cached(
  request: Request,
  ctx: ExecutionContext,
  ttl: number,
  handler: () => Promise<Response>,
): Promise<Response> {
  const key = buildCacheKey(request);
  const hit = await readCache(key);
  if (hit) return withCacheHit(hit);
  const res = await handler();
  writeCache(ctx, key, res, ttl);
  return res;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return withSecurityHeaders(
        new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Max-Age': '86400',
          },
        }),
        pathname,
      );
    }

    if (pathname === '/healthz') {
      return withSecurityHeaders(Response.json({ ok: true, ts: Date.now() }), pathname);
    }

    let response: Response;
    if (pathname === '/api/status') {
      response = await cached(request, ctx, 60, () => handleApiStatus(request, env));
    } else if (pathname === '/api/history') {
      response = await cached(request, ctx, 300, () => handleApiHistory(request, env));
    } else if (pathname === '/api/version') {
      response = await cached(request, ctx, 300, async () => handleApiVersion(request, env));
    } else if (pathname === '/badge.svg') {
      response = await cached(request, ctx, 60, () => handleBadge(request, env));
    } else {
      response = await env.ASSETS.fetch(request);
    }

    if (request.method === 'HEAD' && response.body) {
      response = new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    return withSecurityHeaders(response, pathname);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === '0 0 * * *') {
      ctx.waitUntil(runPrune(env));
    } else {
      ctx.waitUntil(runProbe(env));
    }
  },
};
