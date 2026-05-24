import type { Env, Snapshot, EndpointProbe } from './types';
import {
  getEndpointDefs,
  buildAuthHeaders,
  probeEndpoint,
  type ProbeOutcome,
} from './kalshi-client';
import { determineStatus, exchangeStatusFromBody } from './status';
import { saveSnapshot, pruneSnapshots, saveRegionProbe } from './storage';
import { writeSnapshotIfChanged } from './kv';
import { fetchAndSummarizeChangelog } from './changelog';
import { sampleWebSocket } from './ws-sampler';
import { pushMetrics } from './grafana';
import { detectRegion } from './regions';
import { computeAndStoreUptime } from './uptime';

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
  const outcomes: ProbeOutcome[] = await Promise.all(
    defs.map(async (def): Promise<ProbeOutcome> => {
      if (!def.requires_auth) {
        return probeEndpoint(def, {}, fetchFn);
      }
      if (!keyId || !privateKey) {
        return {
          probe: {
            name: def.name,
            url: def.url,
            method: def.method,
            latency_ms: null,
            status: 'unknown',
            http_status: null,
            requires_auth: true,
            error: 'no_credentials',
          },
          body: null,
        };
      }
      const path = new URL(def.url).pathname + new URL(def.url).search;
      const authHeaders = await buildAuthHeaders(def.method, path, keyId, privateKey);
      return probeEndpoint(def, authHeaders, fetchFn);
    }),
  );

  const probeResults: EndpointProbe[] = outcomes.map((o) => o.probe);
  const exchangeBody = outcomes.find((o) => o.probe.name === 'exchange_status')?.body ?? null;
  const exchange = exchangeStatusFromBody(exchangeBody);
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
  const [prodSnap, demoSnap, region] = await Promise.all([
    probeEnvironment(env, 'prod', fetchFn),
    probeEnvironment(env, 'demo', fetchFn),
    detectRegion(fetchFn),
  ]);

  const isCanonical = region === 'us-east';
  const saves: Promise<unknown>[] = [
    saveSnapshot(env.DB, prodSnap),
    saveSnapshot(env.DB, demoSnap),
  ];
  if (isCanonical) {
    saves.push(writeSnapshotIfChanged(env.KALSHI_KV, prodSnap));
    saves.push(writeSnapshotIfChanged(env.KALSHI_KV, demoSnap));
  }
  if (region !== null) {
    saves.push(
      saveRegionProbe(env.DB, 'prod', {
        region,
        probed_at: prodSnap.ts,
        endpoints: prodSnap.endpoints,
      }),
    );
    saves.push(
      saveRegionProbe(env.DB, 'demo', {
        region,
        probed_at: demoSnap.ts,
        endpoints: demoSnap.endpoints,
      }),
    );
  }
  await Promise.all(saves);

  if (env.GRAFANA_PROM_URL && env.GRAFANA_INSTANCE_ID && env.GRAFANA_API_TOKEN) {
    await Promise.all([
      pushMetrics(prodSnap, env.GRAFANA_PROM_URL, env.GRAFANA_INSTANCE_ID, env.GRAFANA_API_TOKEN),
      pushMetrics(demoSnap, env.GRAFANA_PROM_URL, env.GRAFANA_INSTANCE_ID, env.GRAFANA_API_TOKEN),
    ]);
  }
}

export async function runSlowCron(env: Env): Promise<void> {
  const retentionDays = parseInt(env.SNAPSHOT_RETENTION_DAYS, 10) || 90;
  const now = Date.now();
  await Promise.all([
    pruneSnapshots(env.DB, now, retentionDays),
    pruneRegionProbes(env.DB, now, 7),
    fetchAndSummarizeChangelog(env),
    computeAndStoreUptime(env.DB, now),
  ]);
}

async function pruneRegionProbes(
  db: D1Database,
  nowMs: number,
  retentionDays: number,
): Promise<void> {
  const cutoff = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  await db.prepare('DELETE FROM region_probes WHERE probed_at < ?').bind(cutoff).run();
}
