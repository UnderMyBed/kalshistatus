import { describe, it, expect, vi } from 'vitest';
import {
  buildAuthHeaders,
  normalizePemBody,
  probeEndpoint,
  getEndpointDefs,
} from '../src/kalshi-client';

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

  it('includes exchange_status endpoint flagged as public', () => {
    const defs = getEndpointDefs('https://api.example.com');
    const ex = defs.find((d) => d.name === 'exchange_status');
    expect(ex).toBeDefined();
    expect(ex!.requires_auth).toBe(false);
  });

  it('flags portfolio_* endpoints as requires_auth', () => {
    const defs = getEndpointDefs('https://api.example.com');
    const portfolio = defs.filter((d) => d.name.startsWith('portfolio_'));
    expect(portfolio.length).toBe(4);
    for (const d of portfolio) expect(d.requires_auth).toBe(true);
  });
});

describe('normalizePemBody', () => {
  const body = 'MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSk';

  it('strips standard PKCS8 BEGIN/END headers and whitespace', () => {
    const pem = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
    expect(normalizePemBody(pem)).toBe(body);
  });

  it('strips PKCS1 RSA PRIVATE KEY headers (different label)', () => {
    const pem = `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----`;
    expect(normalizePemBody(pem)).toBe(body);
  });

  it('handles Windows CRLF line endings', () => {
    const pem = `-----BEGIN PRIVATE KEY-----\r\n${body}\r\n-----END PRIVATE KEY-----\r\n`;
    expect(normalizePemBody(pem)).toBe(body);
  });

  it('normalizes literal \\n escape sequences (e.g. when secret was set as a JSON-encoded string)', () => {
    const pem = `-----BEGIN PRIVATE KEY-----\\n${body}\\n-----END PRIVATE KEY-----`;
    expect(normalizePemBody(pem)).toBe(body);
  });

  it('handles leading/trailing whitespace and tabs', () => {
    const pem = `  \t-----BEGIN PRIVATE KEY-----  ${body}  -----END PRIVATE KEY-----  \n`;
    expect(normalizePemBody(pem)).toBe(body);
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
  const def = {
    name: 'exchange_status',
    url: 'https://api.example.com/exchange/status',
    method: 'GET',
    requires_auth: false,
  };

  it('returns up status for 200 response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const { probe } = await probeEndpoint(def, {}, mockFetch);
    expect(probe.status).toBe('up');
    expect(probe.http_status).toBe(200);
    expect(probe.latency_ms).not.toBeNull();
  });

  it('returns down status for 500 response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    const { probe } = await probeEndpoint(def, {}, mockFetch);
    expect(probe.status).toBe('down');
    expect(probe.http_status).toBe(500);
  });

  it('returns down status on network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network failure'));
    const { probe } = await probeEndpoint(def, {}, mockFetch);
    expect(probe.status).toBe('down');
    expect(probe.http_status).toBeNull();
    expect(probe.error).toBe('network failure');
    expect(probe.latency_ms).toBeNull();
  });

  it('parses JSON body when content-type is application/json and status is ok', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ exchange_active: true, trading_active: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { body } = await probeEndpoint(def, {}, mockFetch);
    expect(body).toEqual({ exchange_active: true, trading_active: true });
  });

  it('returns null body when response is non-JSON', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('plain text', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    const { body } = await probeEndpoint(def, {}, mockFetch);
    expect(body).toBeNull();
  });
});
