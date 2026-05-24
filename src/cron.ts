import type { Env, Snapshot } from './types';
import { getEndpointDefs, buildAuthHeaders, probeEndpoint } from './kalshi-client';
import { determineStatus, extractExchangeStatus } from './status';
import { saveSnapshot, pruneSnapshots } from './storage';
import { writeSnapshotIfChanged } from './kv';
import { fetchAndSummarizeChangelog } from './changelog';
import { sampleWebSocket } from './ws-sampler';
import { pushMetrics } from './grafana';

async function probeEnvironment(
  env: Env,
  environment: 'prod' | 'demo',
  fetchFn: typeof fetch,
): Promise<Snapshot> {
  const baseUrl = environment === 'prod' ? env.KALSHI_PROD_REST_BASE : env.KALSHI_DEMO_REST_BASE;
  const keyId = environment === 'prod' ? env.KALSHI_PROD_KEY_ID : env.KALSHI_DEMO_KEY_ID;
  const privateKey =
    environment === 'prod' ? env.KALSHI_PROD_PRIVATE_KEY : env.KALSHI_DEMO_PRIVATE_KEY;

  const defs = getEndpointDefs(baseUrl);
  const probeResults = await Promise.all(
    defs.map(async (def) => {
      try {
        const path = new URL(def.url).pathname + new URL(def.url).search;
        const authHeaders = await buildAuthHeaders(def.method, path, keyId, privateKey);
        return probeEndpoint(def, authHeaders, fetchFn);
      } catch {
        return probeEndpoint(def, {}, fetchFn);
      }
    }),
  );

  const exchangeUrl = `${baseUrl}/exchange/status`;
  const exchange = await extractExchangeStatus(probeResults, exchangeUrl, fetchFn);
  const status = determineStatus(probeResults);

  const wsBase = environment === 'prod' ? env.KALSHI_PROD_WS_BASE : env.KALSHI_DEMO_WS_BASE;
  const sampleMs = Math.max(500, parseInt(env.WS_SAMPLE_MS, 10) || 5000);
  const ws_sample = await sampleWebSocket(wsBase, sampleMs);

  return {
    ts: Date.now(),
    environment,
    status,
    exchange,
    endpoints: probeResults,
    regions: [],
    ws_sample,
  };
}

export async function runFastCron(env: Env, fetchFn: typeof fetch = fetch): Promise<void> {
  const [prodSnap, demoSnap] = await Promise.all([
    probeEnvironment(env, 'prod', fetchFn),
    probeEnvironment(env, 'demo', fetchFn),
  ]);
  await Promise.all([
    saveSnapshot(env.DB, prodSnap),
    saveSnapshot(env.DB, demoSnap),
    writeSnapshotIfChanged(env.KALSHI_KV, prodSnap),
    writeSnapshotIfChanged(env.KALSHI_KV, demoSnap),
  ]);

  if (env.GRAFANA_PROM_URL && env.GRAFANA_INSTANCE_ID && env.GRAFANA_API_TOKEN) {
    await Promise.all([
      pushMetrics(prodSnap, env.GRAFANA_PROM_URL, env.GRAFANA_INSTANCE_ID, env.GRAFANA_API_TOKEN),
      pushMetrics(demoSnap, env.GRAFANA_PROM_URL, env.GRAFANA_INSTANCE_ID, env.GRAFANA_API_TOKEN),
    ]);
  }
}

export async function runSlowCron(env: Env): Promise<void> {
  const retentionDays = parseInt(env.SNAPSHOT_RETENTION_DAYS, 10) || 90;
  await pruneSnapshots(env.DB, Date.now(), retentionDays);
  await fetchAndSummarizeChangelog(env);
}
