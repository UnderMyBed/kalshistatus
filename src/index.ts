import type { Env } from './types';
import { runFastCron, runSlowCron } from './cron';

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/healthz') {
      return Response.json({ ok: true, ts: Date.now() });
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === '0 * * * *') {
      ctx.waitUntil(runSlowCron(env));
    } else {
      ctx.waitUntil(runFastCron(env));
    }
  },
};
