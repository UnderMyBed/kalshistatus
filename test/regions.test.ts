import { describe, it, expect, vi } from 'vitest';
import { coloToRegion, detectRegion } from '../src/regions';

describe('coloToRegion', () => {
  it('maps IAD to us-east', () => expect(coloToRegion('IAD')).toBe('us-east'));
  it('maps DCA to us-east', () => expect(coloToRegion('DCA')).toBe('us-east'));
  it('maps EWR to us-east', () => expect(coloToRegion('EWR')).toBe('us-east'));
  it('maps BOS to us-east', () => expect(coloToRegion('BOS')).toBe('us-east'));
  it('maps ATL to us-east', () => expect(coloToRegion('ATL')).toBe('us-east'));
  it('maps MIA to us-east', () => expect(coloToRegion('MIA')).toBe('us-east'));

  it('maps LHR to eu-west', () => expect(coloToRegion('LHR')).toBe('eu-west'));
  it('maps DUB to eu-west', () => expect(coloToRegion('DUB')).toBe('eu-west'));
  it('maps CDG to eu-west', () => expect(coloToRegion('CDG')).toBe('eu-west'));
  it('maps AMS to eu-west', () => expect(coloToRegion('AMS')).toBe('eu-west'));
  it('maps FRA to eu-west', () => expect(coloToRegion('FRA')).toBe('eu-west'));
  it('maps MAD to eu-west', () => expect(coloToRegion('MAD')).toBe('eu-west'));

  it('maps NRT to asia', () => expect(coloToRegion('NRT')).toBe('asia'));
  it('maps HND to asia', () => expect(coloToRegion('HND')).toBe('asia'));
  it('maps KIX to asia', () => expect(coloToRegion('KIX')).toBe('asia'));
  it('maps SIN to asia', () => expect(coloToRegion('SIN')).toBe('asia'));
  it('maps HKG to asia', () => expect(coloToRegion('HKG')).toBe('asia'));
  it('maps ICN to asia', () => expect(coloToRegion('ICN')).toBe('asia'));

  it('returns null for unknown colo', () => expect(coloToRegion('SFO')).toBeNull());
  it('returns null for empty string', () => expect(coloToRegion('')).toBeNull());
});

describe('detectRegion', () => {
  it('returns region when trace response contains colo', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('fl=123\nip=1.2.3.4\nts=1234\nvisit_scheme=https\nuag=\ncolo=IAD\nsliver=none\n'),
    );
    const region = await detectRegion(mockFetch);
    expect(region).toBe('us-east');
    expect(mockFetch).toHaveBeenCalledWith('https://cloudflare.com/cdn-cgi/trace');
  });

  it('returns null when colo is not in the known set', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('colo=SFO\n'),
    );
    const region = await detectRegion(mockFetch);
    expect(region).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network error'));
    const region = await detectRegion(mockFetch);
    expect(region).toBeNull();
  });

  it('returns null when response has no colo line', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('fl=123\nip=1.2.3.4\n'));
    const region = await detectRegion(mockFetch);
    expect(region).toBeNull();
  });

  it('maps LHR colo to eu-west', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('colo=LHR\n'));
    const region = await detectRegion(mockFetch);
    expect(region).toBe('eu-west');
  });
});
