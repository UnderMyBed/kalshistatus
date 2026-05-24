import type { Env } from './types';
import { runFastCron, runSlowCron } from './cron';
import { handleApiStatus, handleApiHistory, handleBadge } from './api';
import { CostController } from './cost-control';

const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'accelerometer=(), camera=(), geolocation=(), microphone=()',
};

const FRAME_DENY_PATHS = new Set(['/', '/architecture', '/api/status', '/api/history', '/healthz']);

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function withSecurityHeaders(res: Response, pathname: string): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    headers.set(k, v);
  }
  if (FRAME_DENY_PATHS.has(pathname)) {
    headers.set('X-Frame-Options', 'DENY');
    headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'",
    );
  } else if (pathname === '/embed') {
    headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors *",
    );
  }
  const body = NULL_BODY_STATUSES.has(res.status) ? null : res.body;
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

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

    const { allow } = await new CostController(env.KALSHI_KV).check();
    if (!allow) {
      return withSecurityHeaders(
        Response.json(
          { error: 'budget_exceeded', retry_after: 3600 },
          { status: 503, headers: { 'Retry-After': '3600' } },
        ),
        pathname,
      );
    }

    let response: Response;
    if (pathname === '/api/status') {
      response = await handleApiStatus(request, env);
    } else if (pathname === '/api/history') {
      response = await handleApiHistory(request, env);
    } else if (pathname === '/badge.svg') {
      response = await handleBadge(request, env);
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

    ctx; // unused but keep for future cron-on-fetch patterns
    return withSecurityHeaders(response, pathname);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === '0 * * * *') {
      ctx.waitUntil(runSlowCron(env));
    } else {
      const mode = await new CostController(env.KALSHI_KV).getMode();
      if (mode !== 'blocked') ctx.waitUntil(runFastCron(env));
    }
  },
};
