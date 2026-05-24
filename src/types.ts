export type Environment = 'prod' | 'demo';
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
  requires_auth: boolean;
  error?: string;
}

export interface RegionProbe {
  region: 'us-east' | 'eu-west' | 'asia';
  probed_at: number;
  endpoints: EndpointProbe[];
}

export interface ExchangeStatus {
  exchange_active: boolean;
  trading_active: boolean;
}

export interface WsSample {
  connected: boolean;
  latency_ms: number | null;
  tickers_received: number;
  sampled_at: number;
  error?: string;
}

export interface UptimeWindow {
  pct: number;
  ok_count: number;
  total_count: number;
}

export interface UptimeMetrics {
  computed_at: number;
  windows: Record<string, UptimeWindow>;
}

export interface Snapshot {
  ts: number;
  environment: Environment;
  status: OverallStatus;
  exchange: ExchangeStatus;
  endpoints: EndpointProbe[];
  regions: RegionProbe[];
  ws_sample?: WsSample;
  uptime?: UptimeMetrics;
}

export interface ChangelogEntry {
  link: string;
  title: string;
  summary_ai: string;
  pub_date_ts: number;
}

export interface Env {
  DB: D1Database;
  KALSHI_KV: KVNamespace;
  AI: Ai;
  ASSETS: Fetcher;
  COST_COUNTER: DurableObjectNamespace<import('./cost-counter-do').CostCounter>;
  KALSHI_PROD_REST_BASE: string;
  KALSHI_PROD_WS_BASE: string;
  KALSHI_DEMO_REST_BASE: string;
  KALSHI_DEMO_WS_BASE: string;
  WS_SAMPLE_MS: string;
  SNAPSHOT_RETENTION_DAYS: string;
  GRAFANA_PROM_URL: string;
  GRAFANA_INSTANCE_ID: string;
  PUBLIC_DASHBOARD_URL: string;
  VERSION: string;
  COMMIT_SHA: string;
  KALSHI_PROD_KEY_ID?: string;
  KALSHI_PROD_PRIVATE_KEY_PEM?: string;
  KALSHI_DEMO_KEY_ID?: string;
  KALSHI_DEMO_PRIVATE_KEY_PEM?: string;
  GRAFANA_API_TOKEN?: string;
}
