import type { Env } from './types';
import { runFastCron, runSlowCron } from './cron';
import { handleApiStatus, handleApiHistory, handleBadge } from './api';
import { CostController } from './cost-control';
import { handleGrafanaInit } from './grafana-init';

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

    const { allow } = await new CostController(env.KALSHI_KV).check();
    if (!allow) {
      return Response.json(
        { error: 'budget_exceeded', retry_after: 3600 },
        { status: 503, headers: { 'Retry-After': '3600' } },
      );
    }

    if (pathname === '/api/grafana-init') return handleGrafanaInit(request, env.GRAFANA_API_TOKEN);
    if (pathname === '/api/status') return handleApiStatus(request, env);
    if (pathname === '/api/history') return handleApiHistory(request, env);
    if (pathname === '/badge.svg') return handleBadge(request, env);

    return env.ASSETS.fetch(request);
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
