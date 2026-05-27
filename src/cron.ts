import type { Env, Snapshot } from './types';
import { getEndpointDefs, probeEndpoint } from './kalshi-client';
import { determineStatus, exchangeStatusFromBody } from './status';
import { saveSnapshot, pruneSnapshots } from './storage';

export async function runProbe(env: Env, fetchFn: typeof fetch = fetch): Promise<void> {
  const defs = getEndpointDefs(env.KALSHI_PROD_REST_BASE);
  const outcomes = await Promise.all(defs.map((def) => probeEndpoint(def, fetchFn)));
  const endpoints = outcomes.map((o) => o.probe);
  const exchangeBody = outcomes.find((o) => o.probe.name === 'exchange_status')?.body ?? null;

  const snapshot: Snapshot = {
    ts: Date.now(),
    status: determineStatus(endpoints),
    exchange: exchangeStatusFromBody(exchangeBody),
    endpoints,
  };
  await saveSnapshot(env.DB, snapshot);
}

export async function runPrune(env: Env): Promise<void> {
  const retentionDays = parseInt(env.SNAPSHOT_RETENTION_DAYS, 10) || 30;
  await pruneSnapshots(env.DB, Date.now(), retentionDays);
}
