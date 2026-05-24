import { describe, it, expect, beforeEach } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import { CostController } from '../src/cost-control';
import type { CostCounter } from '../src/cost-counter-do';

async function resetCounter(): Promise<void> {
  const id = env.COST_COUNTER.idFromName('global');
  const stub = env.COST_COUNTER.get(id);
  await runInDurableObject(stub, async (_inst, state) => {
    state.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS daily_count (day TEXT PRIMARY KEY, count INTEGER NOT NULL)`,
    );
    state.storage.sql.exec(`DELETE FROM daily_count`);
  });
}

async function setCount(count: number, day?: string): Promise<void> {
  const id = env.COST_COUNTER.idFromName('global');
  const stub = env.COST_COUNTER.get(id);
  const today = day ?? new Date().toISOString().slice(0, 10);
  await runInDurableObject(stub, async (_inst: CostCounter, state) => {
    state.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS daily_count (day TEXT PRIMARY KEY, count INTEGER NOT NULL)`,
    );
    state.storage.sql.exec(`DELETE FROM daily_count`);
    state.storage.sql.exec(`INSERT INTO daily_count (day, count) VALUES (?, ?)`, today, count);
  });
}

beforeEach(async () => {
  await resetCounter();
});

describe('CostController (Durable Object backed)', () => {
  it('allows requests below soft threshold', async () => {
    const cc = new CostController(env.COST_COUNTER);
    const result = await cc.check();
    expect(result.allow).toBe(true);
    expect(result.mode).toBe('normal');
    expect(result.count).toBe(1);
  });

  it('counts atomically across many check() calls', async () => {
    const cc = new CostController(env.COST_COUNTER);
    for (let i = 0; i < 50; i++) await cc.check();
    const result = await cc.check();
    expect(result.count).toBe(51);
  });

  it('enters shed mode at the soft threshold', async () => {
    await setCount(80_000);
    const cc = new CostController(env.COST_COUNTER);
    const result = await cc.check();
    expect(result.mode).toBe('shed');
    expect(result.allow).toBe(true);
  });

  it('blocks at the hard threshold', async () => {
    await setCount(95_000);
    const cc = new CostController(env.COST_COUNTER);
    const result = await cc.check();
    expect(result.allow).toBe(false);
    expect(result.mode).toBe('blocked');
  });

  it('resets counter on new UTC day', async () => {
    await setCount(96_000, '2020-01-01');
    const cc = new CostController(env.COST_COUNTER);
    const result = await cc.check();
    expect(result.allow).toBe(true);
    expect(result.mode).toBe('normal');
    expect(result.count).toBe(1);
  });

  it('getMode reads the same count without incrementing', async () => {
    await setCount(80_000);
    const cc = new CostController(env.COST_COUNTER);
    expect(await cc.getMode()).toBe('shed');
    expect(await cc.getMode()).toBe('shed');
    const result = await cc.check();
    expect(result.count).toBe(80_001);
  });
});
