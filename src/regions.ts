import type { RegionProbe } from './types';

export type Region = RegionProbe['region'];

const COLO_MAP: Record<string, Region> = {
  IAD: 'us-east',
  DCA: 'us-east',
  EWR: 'us-east',
  BOS: 'us-east',
  ATL: 'us-east',
  MIA: 'us-east',
  LHR: 'eu-west',
  DUB: 'eu-west',
  CDG: 'eu-west',
  AMS: 'eu-west',
  FRA: 'eu-west',
  MAD: 'eu-west',
  NRT: 'asia',
  HND: 'asia',
  KIX: 'asia',
  SIN: 'asia',
  HKG: 'asia',
  ICN: 'asia',
};

export function coloToRegion(colo: string): Region | null {
  return COLO_MAP[colo] ?? null;
}

export async function detectRegion(fetchFn: typeof fetch): Promise<Region | null> {
  try {
    const res = await fetchFn('https://cloudflare.com/cdn-cgi/trace');
    const text = await res.text();
    const match = text.match(/^colo=(\w+)$/m);
    if (!match) return null;
    return coloToRegion(match[1]);
  } catch {
    return null;
  }
}
