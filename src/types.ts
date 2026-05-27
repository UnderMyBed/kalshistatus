export type OverallStatus =
  | 'operational'
  | 'degraded'
  | 'partial_outage'
  | 'major_outage'
  | 'unknown';
export type EndpointStatus = 'up' | 'down' | 'degraded' | 'unknown';

export interface EndpointProbe {
  name: string;
  url: string;
  method: string;
  latency_ms: number | null;
  status: EndpointStatus;
  http_status: number | null;
  error?: string;
}

export interface ExchangeStatus {
  exchange_active: boolean;
  trading_active: boolean;
}

export interface Snapshot {
  ts: number;
  status: OverallStatus;
  exchange: ExchangeStatus;
  endpoints: EndpointProbe[];
}

export interface UptimeWindow {
  pct: number;
  ok_count: number;
  total_count: number;
}

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  KALSHI_PROD_REST_BASE: string;
  SNAPSHOT_RETENTION_DAYS: string;
  VERSION: string;
  COMMIT_SHA: string;
}
