const SOFT_THRESHOLD = 80_000;
const HARD_THRESHOLD = 95_000;
const KV_KEY = 'cost:daily_count';
const PERSIST_EVERY = 100;

interface CounterState {
  count: number;
  day: string;
}

type CostMode = 'normal' | 'shed' | 'blocked';

export interface CheckResult {
  allow: boolean;
  mode: CostMode;
}

export class CostController {
  private kv: KVNamespace;
  private inMemoryCount = 0;
  private inMemoryDay = '';
  private loaded = false;

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  async check(): Promise<CheckResult> {
    await this.load();
    this.inMemoryCount++;

    if (this.inMemoryCount % PERSIST_EVERY === 0) {
      await this.persist();
    }

    if (this.inMemoryCount >= HARD_THRESHOLD) {
      return { allow: false, mode: 'blocked' };
    }
    if (this.inMemoryCount >= SOFT_THRESHOLD) {
      return { allow: true, mode: 'shed' };
    }
    return { allow: true, mode: 'normal' };
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    const today = new Date().toISOString().slice(0, 10);
    const raw = await this.kv.get(KV_KEY);
    if (!raw) {
      this.inMemoryCount = 0;
      this.inMemoryDay = today;
      return;
    }

    const state: CounterState = JSON.parse(raw);
    if (state.day !== today) {
      this.inMemoryCount = 0;
      this.inMemoryDay = today;
    } else {
      this.inMemoryCount = state.count;
      this.inMemoryDay = state.day;
    }
  }

  private async persist(): Promise<void> {
    await this.kv.put(
      KV_KEY,
      JSON.stringify({ count: this.inMemoryCount, day: this.inMemoryDay }),
      { expirationTtl: 90_000 },
    );
  }
}
