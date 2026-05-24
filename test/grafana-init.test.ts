import { describe, it, expect, vi } from 'vitest';
import { handleGrafanaInit } from '../src/grafana-init';

function makeRequest(key?: string) {
  const url = key
    ? `https://example.com/api/grafana-init?key=${key}`
    : 'https://example.com/api/grafana-init';
  return new Request(url);
}

function mockFetchSequence(responses: Array<{ body: unknown; status?: number }>) {
  let call = 0;
  return vi.fn().mockImplementation(() => {
    const r = responses[call++];
    return Promise.resolve(
      new Response(JSON.stringify(r.body), {
        status: r.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
}

describe('handleGrafanaInit', () => {
  it('returns 403 when key is missing', async () => {
    const res = await handleGrafanaInit(makeRequest(), 'token');
    expect(res.status).toBe(403);
  });

  it('returns 403 when key is wrong', async () => {
    const res = await handleGrafanaInit(makeRequest('wrong-key'), 'token');
    expect(res.status).toBe(403);
  });

  it('returns 500 when token is undefined', async () => {
    const res = await handleGrafanaInit(makeRequest('kalshi-grafana-init-2026'), undefined);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('GRAFANA_API_TOKEN');
  });

  it('returns 500 when dashboard creation fails', async () => {
    const mockFetch = mockFetchSequence([{ body: { status: 'error', message: 'bad' } }]);
    const res = await handleGrafanaInit(
      makeRequest('kalshi-grafana-init-2026'),
      'token',
      mockFetch,
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('dashboard creation failed');
  });

  it('creates new public dashboard and returns url', async () => {
    const mockFetch = mockFetchSequence([
      { body: { status: 'success', uid: 'abc123' } },
      { body: {} },
      { body: { accessToken: 'tok999', isEnabled: true, uid: 'pd1' } },
    ]);
    const res = await handleGrafanaInit(
      makeRequest('kalshi-grafana-init-2026'),
      'token',
      mockFetch,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; uid: string };
    expect(body.url).toContain('tok999');
    expect(body.uid).toBe('abc123');
  });

  it('reuses existing public dashboard accessToken', async () => {
    const mockFetch = mockFetchSequence([
      { body: { status: 'success', uid: 'abc123' } },
      { body: { accessToken: 'existing-tok', isEnabled: true, uid: 'pd1' } },
    ]);
    const res = await handleGrafanaInit(
      makeRequest('kalshi-grafana-init-2026'),
      'token',
      mockFetch,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toContain('existing-tok');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('re-enables disabled public dashboard', async () => {
    const mockFetch = mockFetchSequence([
      { body: { status: 'success', uid: 'abc123' } },
      { body: { accessToken: 'disabled-tok', isEnabled: false, uid: 'pd1' } },
      { body: { isEnabled: true } },
    ]);
    const res = await handleGrafanaInit(
      makeRequest('kalshi-grafana-init-2026'),
      'token',
      mockFetch,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toContain('disabled-tok');
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const patchCall = mockFetch.mock.calls[2] as [string, RequestInit];
    expect(patchCall[1].method).toBe('PATCH');
  });

  it('returns 500 when public dashboard creation returns no accessToken', async () => {
    const mockFetch = mockFetchSequence([
      { body: { status: 'success', uid: 'abc123' } },
      { body: {} },
      { body: { error: 'forbidden' }, status: 403 },
    ]);
    const res = await handleGrafanaInit(
      makeRequest('kalshi-grafana-init-2026'),
      'token',
      mockFetch,
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('public dashboard creation failed');
  });
});
