import type { RegionProbe } from './types';

export type Region = RegionProbe['region'];

const COLO_MAP: Record<string, Region> = {
  // US / Canada → us-east (single Americas region)
  IAD: 'us-east', DCA: 'us-east', EWR: 'us-east', JFK: 'us-east',
  BOS: 'us-east', PHL: 'us-east', PIT: 'us-east', RDU: 'us-east',
  ATL: 'us-east', CLT: 'us-east', BNA: 'us-east', CMH: 'us-east',
  MCO: 'us-east', TPA: 'us-east', MIA: 'us-east', MCI: 'us-east',
  MSP: 'us-east', STL: 'us-east', ORD: 'us-east', DTW: 'us-east',
  DFW: 'us-east', DAL: 'us-east', IAH: 'us-east', SAT: 'us-east',
  DEN: 'us-east', SLC: 'us-east', PHX: 'us-east', LAS: 'us-east',
  LAX: 'us-east', SFO: 'us-east', SJC: 'us-east', SEA: 'us-east',
  PDX: 'us-east', YYZ: 'us-east', YVR: 'us-east', YUL: 'us-east',
  // Europe → eu-west
  LHR: 'eu-west', LGW: 'eu-west', MAN: 'eu-west', DUB: 'eu-west',
  CDG: 'eu-west', ORY: 'eu-west', AMS: 'eu-west', BRU: 'eu-west',
  FRA: 'eu-west', MUC: 'eu-west', DUS: 'eu-west', HAM: 'eu-west',
  TXL: 'eu-west', BER: 'eu-west', MAD: 'eu-west', BCN: 'eu-west',
  LIS: 'eu-west', FCO: 'eu-west', MXP: 'eu-west', VIE: 'eu-west',
  ZRH: 'eu-west', GVA: 'eu-west', ARN: 'eu-west', CPH: 'eu-west',
  HEL: 'eu-west', OSL: 'eu-west', WAW: 'eu-west', PRG: 'eu-west',
  BUD: 'eu-west', SOF: 'eu-west', OTP: 'eu-west', ATH: 'eu-west',
  // Asia / Pacific / Middle East → asia
  NRT: 'asia', HND: 'asia', KIX: 'asia', CTS: 'asia',
  SIN: 'asia', KUL: 'asia', CGK: 'asia', BKK: 'asia',
  HKG: 'asia', ICN: 'asia', PUS: 'asia', TPE: 'asia',
  CAN: 'asia', PVG: 'asia', PEK: 'asia', PKX: 'asia',
  SZX: 'asia', CTU: 'asia', MNL: 'asia', SGN: 'asia',
  BOM: 'asia', DEL: 'asia', MAA: 'asia', BLR: 'asia',
  HYD: 'asia', CCU: 'asia', DXB: 'asia', DOH: 'asia',
  AUH: 'asia', BAH: 'asia', KWI: 'asia', AMM: 'asia',
  TLV: 'asia', IST: 'asia', SYD: 'asia', MEL: 'asia',
  AKL: 'asia',
};

export function coloToRegion(colo: string): Region | null {
  return COLO_MAP[colo] ?? null;
}

export async function detectRegion(fetchFn: typeof fetch): Promise<Region | null> {
  try {
    const res = await fetchFn('https://cloudflare.com/cdn-cgi/trace');
    if (!res.ok) return null;
    const text = await res.text();
    const match = text.match(/^colo=(\w+)$/m);
    if (!match) return null;
    return coloToRegion(match[1]);
  } catch {
    return null;
  }
}
