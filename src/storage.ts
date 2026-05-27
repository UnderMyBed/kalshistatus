import type { Snapshot, UptimeWindow } from './types';

interface SnapshotRow {
  ts: number;
  status: string;
  exchange_active: number;
  trading_active: number;
  endpoints: string;
}

function rowToSnapshot(row: SnapshotRow): Snapshot {
  return {
    ts: row.ts,
    status: row.status as Snapshot['status'],
    exchange: {
      exchange_active: row.exchange_active === 1,
      trading_active: row.trading_active === 1,
    },
    endpoints: JSON.parse(row.endpoints) as Snapshot['endpoints'],
  };
}

export async function saveSnapshot(db: D1Database, snap: Snapshot): Promise<void> {
  await db
    .prepare(
      'INSERT OR REPLACE INTO snapshots (ts, status, exchange_active, trading_active, endpoints) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(
      snap.ts,
      snap.status,
      snap.exchange.exchange_active ? 1 : 0,
      snap.exchange.trading_active ? 1 : 0,
      JSON.stringify(snap.endpoints),
    )
    .run();
}

export async function loadLatestSnapshot(db: D1Database): Promise<Snapshot | null> {
  const row = await db
    .prepare('SELECT * FROM snapshots ORDER BY ts DESC LIMIT 1')
    .first<SnapshotRow>();
  return row ? rowToSnapshot(row) : null;
}

export async function readSnapshotsSince(db: D1Database, sinceMs: number): Promise<Snapshot[]> {
  const { results } = await db
    .prepare('SELECT * FROM snapshots WHERE ts >= ? ORDER BY ts ASC')
    .bind(sinceMs)
    .all<SnapshotRow>();
  return results.map(rowToSnapshot);
}

export async function computeUptime(db: D1Database, sinceMs: number): Promise<UptimeWindow> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('operational','degraded') THEN 1 ELSE 0 END) AS ok FROM snapshots WHERE ts >= ?",
    )
    .bind(sinceMs)
    .first<{ total: number; ok: number | null }>();
  const total = row!.total;
  const ok = row!.ok ?? 0;
  return { total_count: total, ok_count: ok, pct: total === 0 ? 0 : (ok / total) * 100 };
}

export async function pruneSnapshots(
  db: D1Database,
  nowMs: number,
  retentionDays: number,
): Promise<void> {
  const cutoff = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  await db.prepare('DELETE FROM snapshots WHERE ts < ?').bind(cutoff).run();
}
