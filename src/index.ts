import type { Env } from './types';
import { runFastCron, runSlowCron } from './cron';
import { handleApiStatus, handleApiHistory, handleBadge } from './api';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
        },
      });
    }

    if (pathname === '/healthz') return Response.json({ ok: true, ts: Date.now() });
    if (pathname === '/api/status') return handleApiStatus(request, env);
    if (pathname === '/api/history') return handleApiHistory(request, env);
    if (pathname === '/badge.svg') return handleBadge(request, env);

    return env.ASSETS.fetch(request);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === '0 * * * *') {
      ctx.waitUntil(runSlowCron(env));
    } else {
      ctx.waitUntil(runFastCron(env));
    }
  },
};
