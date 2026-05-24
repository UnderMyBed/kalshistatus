import { describe, it, expect, vi } from 'vitest';
import { buildAuthHeaders, probeEndpoint, getEndpointDefs } from '../src/kalshi-client';

describe('getEndpointDefs', () => {
  it('returns 8 endpoint definitions', () => {
    const defs = getEndpointDefs('https://api.example.com');
    expect(defs).toHaveLength(8);
  });

  it('builds URLs from the provided base URL', () => {
    const base = 'https://api.example.com';
    const defs = getEndpointDefs(base);
    for (const def of defs) {
      expect(def.url.startsWith(base)).toBe(true);
    }
  });

  it('includes exchange_status endpoint', () => {
    const defs = getEndpointDefs('https://api.example.com');
    expect(defs.some((d) => d.name === 'exchange_status')).toBe(true);
  });
});

describe('buildAuthHeaders', () => {
  it('returns empty object when credentials are absent', async () => {
    const headers = await buildAuthHeaders('GET', '/exchange/status', undefined, undefined);
    expect(headers).toEqual({});
  });

  it('returns auth headers when credentials are present', async () => {
    const { privateKey } = await crypto.subtle.generateKey(
      {
        name: 'RSA-PSS',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
    const exported = await crypto.subtle.exportKey('pkcs8', privateKey);
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(exported)))}\n-----END PRIVATE KEY-----`;

    const headers = await buildAuthHeaders('GET', '/exchange/status', 'key-id-123', pem);
    expect(headers['KALSHI-ACCESS-KEY']).toBe('key-id-123');
    expect(typeof headers['KALSHI-ACCESS-TIMESTAMP']).toBe('string');
    expect(typeof headers['KALSHI-ACCESS-SIGNATURE']).toBe('string');
  });
});

describe('probeEndpoint', () => {
  it('returns up status for 200 response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const result = await probeEndpoint(
      { name: 'exchange_status', url: 'https://api.example.com/exchange/status', method: 'GET' },
      {},
      mockFetch,
    );
    expect(result.status).toBe('up');
    expect(result.http_status).toBe(200);
    expect(result.latency_ms).not.toBeNull();
  });

  it('returns down status for 500 response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    const result = await probeEndpoint(
      { name: 'exchange_status', url: 'https://api.example.com/exchange/status', method: 'GET' },
      {},
      mockFetch,
    );
    expect(result.status).toBe('down');
    expect(result.http_status).toBe(500);
  });

  it('returns down status on network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network failure'));
    const result = await probeEndpoint(
      { name: 'exchange_status', url: 'https://api.example.com/exchange/status', method: 'GET' },
      {},
      mockFetch,
    );
    expect(result.status).toBe('down');
    expect(result.http_status).toBeNull();
    expect(result.error).toBe('network failure');
    expect(result.latency_ms).toBeNull();
  });
});
