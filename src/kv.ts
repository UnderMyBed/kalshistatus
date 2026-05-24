import type { Environment, Snapshot } from './types';

const KV_KEY = (env: Environment) => `snapshot:${env}`;
const HASH_KEY = (env: Environment) => `hash:${env}`;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function writeSnapshotIfChanged(kv: KVNamespace, snap: Snapshot): Promise<boolean> {
  const payload = JSON.stringify(snap);
  const newHash = await sha256(payload);
  const prevHash = await kv.get(HASH_KEY(snap.environment));
  if (prevHash === newHash) return false;
  await Promise.all([
    kv.put(KV_KEY(snap.environment), payload),
    kv.put(HASH_KEY(snap.environment), newHash),
  ]);
  return true;
}

export async function readLatestSnapshot(
  kv: KVNamespace,
  environment: Environment,
): Promise<Snapshot | null> {
  const raw = await kv.get(KV_KEY(environment));
  if (!raw) return null;
  return JSON.parse(raw) as Snapshot;
}
