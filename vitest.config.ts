import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    typecheck: { tsconfig: './tsconfig.test.json' },
    poolOptions: {
      workers: { wrangler: { configPath: './wrangler.toml' } },
    },
  },
});
