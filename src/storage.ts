import type { Environment, Snapshot, RegionProbe } from './types';

export async function saveSnapshot(db: D1Database, snap: Snapshot): Promise<void> {
  await db
    .prepare('INSERT OR REPLACE INTO snapshots (ts, environment, payload) VALUES (?, ?, ?)')
    .bind(snap.ts, snap.environment, JSON.stringify(snap))
    .run();
}

export async function loadLatestSnapshot(
  db: D1Database,
  environment: Environment,
): Promise<Snapshot | null> {
  const row = await db
    .prepare('SELECT payload FROM snapshots WHERE environment = ? ORDER BY ts DESC LIMIT 1')
    .bind(environment)
    .first<{ payload: string }>();
  if (!row) return null;
  return JSON.parse(row.payload) as Snapshot;
}

export async function readSnapshotHistory(
  db: D1Database,
  environment: Environment,
  limit: number,
): Promise<Snapshot[]> {
  const rows = await db
    .prepare('SELECT payload FROM snapshots WHERE environment = ? ORDER BY ts DESC LIMIT ?')
    .bind(environment, limit)
    .all<{ payload: string }>();
  return rows.results.map((r) => JSON.parse(r.payload) as Snapshot);
}

export async function readSnapshotAt(
  db: D1Database,
  environment: Environment,
  ts: number,
): Promise<Snapshot | null> {
  const tolerance = 5 * 60 * 1000;
  const row = await db
    .prepare(
      `SELECT payload FROM snapshots WHERE environment = ? AND ts BETWEEN ? AND ? ORDER BY ABS(ts - ?) ASC LIMIT 1`,
    )
    .bind(environment, ts - tolerance, ts + tolerance, ts)
    .first<{ payload: string }>();
  if (!row) return null;
  return JSON.parse(row.payload) as Snapshot;
}

export async function pruneSnapshots(
  db: D1Database,
  nowMs: number,
  retentionDays: number,
): Promise<void> {
  const cutoff = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  await db.prepare('DELETE FROM snapshots WHERE ts < ?').bind(cutoff).run();
}

export async function saveRegionProbe(
  db: D1Database,
  environment: Environment,
  probe: RegionProbe,
): Promise<void> {
  await db
    .prepare(
      'INSERT OR REPLACE INTO region_probes (environment, region, probed_at, payload) VALUES (?, ?, ?, ?)',
    )
    .bind(environment, probe.region, probe.probed_at, JSON.stringify(probe))
    .run();
}

export async function loadRecentRegionProbes(
  db: D1Database,
  environment: Environment,
  sinceMs: number,
): Promise<RegionProbe[]> {
  const rows = await db
    .prepare('SELECT payload FROM region_probes WHERE environment = ? AND probed_at >= ?')
    .bind(environment, sinceMs)
    .all<{ payload: string }>();
  return rows.results.map((r) => JSON.parse(r.payload) as RegionProbe);
}
