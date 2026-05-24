import { DurableObject } from 'cloudflare:workers';

const SOFT_THRESHOLD = 80_000;
const HARD_THRESHOLD = 95_000;

export type CostMode = 'normal' | 'shed' | 'blocked';
export interface CostCheckResult {
  allow: boolean;
  mode: CostMode;
  count: number;
}

interface CostCounterEnv {
  [key: string]: unknown;
}

export class CostCounter extends DurableObject<CostCounterEnv> {
  private sql: SqlStorage;

  constructor(state: DurableObjectState, env: CostCounterEnv) {
    super(state, env);
    this.sql = state.storage.sql;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS daily_count (
         day TEXT PRIMARY KEY,
         count INTEGER NOT NULL
       )`,
    );
  }

  async check(): Promise<CostCheckResult> {
    const today = this.todayUtc();
    this.sql.exec(
      `INSERT INTO daily_count (day, count) VALUES (?, 1)
         ON CONFLICT(day) DO UPDATE SET count = count + 1`,
      today,
    );
    const row = this.sql
      .exec<{ count: number }>('SELECT count FROM daily_count WHERE day = ?', today)
      .one();
    const count = row.count;
    this.maybePrune(today);
    return {
      allow: count < HARD_THRESHOLD,
      mode: count >= HARD_THRESHOLD ? 'blocked' : count >= SOFT_THRESHOLD ? 'shed' : 'normal',
      count,
    };
  }

  async getMode(): Promise<CostMode> {
    const today = this.todayUtc();
    const row = this.sql
      .exec<{ count: number }>('SELECT count FROM daily_count WHERE day = ?', today)
      .toArray()[0];
    const count = row?.count ?? 0;
    if (count >= HARD_THRESHOLD) return 'blocked';
    if (count >= SOFT_THRESHOLD) return 'shed';
    return 'normal';
  }

  private maybePrune(today: string): void {
    this.sql.exec('DELETE FROM daily_count WHERE day < ?', today);
  }

  private todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
