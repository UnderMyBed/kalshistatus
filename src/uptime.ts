import type { Environment, UptimeMetrics } from './types';

const WINDOWS_HOURS = [24, 168, 720] as const;

interface ComputeRow {
  ok_count: number;
  total_count: number;
}

export async function computeAndStoreUptime(db: D1Database, nowMs: number): Promise<void> {
  for (const environment of ['prod', 'demo'] as Environment[]) {
    for (const hours of WINDOWS_HOURS) {
      const since = nowMs - hours * 60 * 60 * 1000;
      const row = await db
        .prepare(
          `SELECT
             COUNT(*) AS total_count,
             SUM(CASE
               WHEN json_extract(payload, '$.status') IN ('operational', 'degraded')
               THEN 1 ELSE 0 END) AS ok_count
           FROM snapshots
           WHERE environment = ? AND ts >= ?`,
        )
        .bind(environment, since)
        .first<ComputeRow>();
      const total = row?.total_count ?? 0;
      const ok = row?.ok_count ?? 0;
      const pct = total > 0 ? (100 * ok) / total : 0;
      await db
        .prepare(
          `INSERT OR REPLACE INTO uptime_metrics
             (environment, window_hours, computed_at, ok_count, total_count, pct)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(environment, hours, nowMs, ok, total, pct)
        .run();
    }
  }
}

export async function readUptimeMetrics(
  db: D1Database,
  environment: Environment,
): Promise<UptimeMetrics | null> {
  const { results } = await db
    .prepare(
      `SELECT window_hours, computed_at, ok_count, total_count, pct
         FROM uptime_metrics WHERE environment = ?`,
    )
    .bind(environment)
    .all<{
      window_hours: number;
      computed_at: number;
      ok_count: number;
      total_count: number;
      pct: number;
    }>();
  if (results.length === 0) return null;
  const windows: UptimeMetrics['windows'] = {};
  let latestComputedAt = 0;
  for (const r of results) {
    windows[String(r.window_hours)] = {
      pct: r.pct,
      ok_count: r.ok_count,
      total_count: r.total_count,
    };
    latestComputedAt = Math.max(latestComputedAt, r.computed_at);
  }
  return { computed_at: latestComputedAt, windows };
}
