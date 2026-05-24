import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { writeSnapshotIfChanged, readLatestSnapshot } from '../src/kv';
import type { Snapshot } from '../src/types';

function makeSnapshot(ts: number, status: 'operational' | 'degraded' = 'operational'): Snapshot {
  return {
    ts,
    environment: 'prod',
    status,
    exchange: { exchange_active: true, trading_active: true },
    endpoints: [],
    regions: [],
  };
}

describe('writeSnapshotIfChanged / readLatestSnapshot', () => {
  beforeEach(async () => {
    // KV is isolated per test via the pool-workers harness; no manual clear needed
  });

  it('writes the snapshot and returns true when KV is empty', async () => {
    const snap = makeSnapshot(1000);
    const wrote = await writeSnapshotIfChanged(env.KALSHI_KV, snap);
    expect(wrote).toBe(true);
  });

  it('returns the written snapshot via readLatestSnapshot', async () => {
    const snap = makeSnapshot(2000);
    await writeSnapshotIfChanged(env.KALSHI_KV, snap);
    const loaded = await readLatestSnapshot(env.KALSHI_KV, 'prod');
    expect(loaded).not.toBeNull();
    expect(loaded!.ts).toBe(2000);
  });

  it('returns false (no write) when snapshot payload is identical', async () => {
    const snap = makeSnapshot(3000);
    await writeSnapshotIfChanged(env.KALSHI_KV, snap);
    const wrote = await writeSnapshotIfChanged(env.KALSHI_KV, snap);
    expect(wrote).toBe(false);
  });

  it('returns true and overwrites when snapshot content changes', async () => {
    const snap1 = makeSnapshot(4000, 'operational');
    const snap2 = makeSnapshot(4000, 'degraded');
    await writeSnapshotIfChanged(env.KALSHI_KV, snap1);
    const wrote = await writeSnapshotIfChanged(env.KALSHI_KV, snap2);
    expect(wrote).toBe(true);
    const loaded = await readLatestSnapshot(env.KALSHI_KV, 'prod');
    expect(loaded!.status).toBe('degraded');
  });

  it('returns null from readLatestSnapshot when nothing was written', async () => {
    const result = await readLatestSnapshot(env.KALSHI_KV, 'prod');
    expect(result).toBeNull();
  });
});
