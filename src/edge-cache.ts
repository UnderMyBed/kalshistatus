export function buildCacheKey(request: Request): Request {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  for (const k of Array.from(url.searchParams.keys()).sort()) {
    const v = url.searchParams.get(k);
    if (v !== null) params.set(k, v);
  }
  const search = params.toString();
  const canonical = `${url.protocol}//${url.host}${url.pathname}${search ? '?' + search : ''}`;
  return new Request(canonical, { method: 'GET' });
}

export async function readCache(key: Request): Promise<Response | null> {
  const hit = await caches.default.match(key);
  return hit ?? null;
}

export function writeCache(
  ctx: ExecutionContext,
  key: Request,
  response: Response,
  ttl: number,
): void {
  if (!response.ok) return;
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', `public, max-age=${ttl}`);
  const cacheable = new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  ctx.waitUntil(caches.default.put(key, cacheable));
}

export function withCacheHit(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Cache', 'HIT');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
