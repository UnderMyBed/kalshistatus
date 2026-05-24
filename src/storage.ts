import type { Environment, Snapshot } from './types';

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

export async function pruneSnapshots(
  db: D1Database,
  nowMs: number,
  retentionDays: number,
): Promise<void> {
  const cutoff = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  await db.prepare('DELETE FROM snapshots WHERE ts < ?').bind(cutoff).run();
}
