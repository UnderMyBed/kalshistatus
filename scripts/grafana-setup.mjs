#!/usr/bin/env node
/**
 * One-time Grafana dashboard provisioning.
 * Run: GRAFANA_STACK_URL=https://<stack>.grafana.net GRAFANA_SA_TOKEN=<token> node scripts/grafana-setup.mjs
 */

const STACK_URL = process.env.GRAFANA_STACK_URL;
const TOKEN = process.env.GRAFANA_SA_TOKEN;

if (!STACK_URL || !TOKEN) {
  console.error('Set GRAFANA_STACK_URL and GRAFANA_SA_TOKEN');
  process.exit(1);
}

const dashboard = {
  title: 'Kalshi API Status',
  panels: [
    {
      id: 1,
      title: 'Endpoint Latency (prod)',
      type: 'timeseries',
      gridPos: { h: 8, w: 12, x: 0, y: 0 },
      targets: [{ expr: 'kalshi_endpoint_latency_ms{environment="prod"}', legendFormat: '{{endpoint}}' }],
    },
    {
      id: 2,
      title: 'Endpoint Latency (demo)',
      type: 'timeseries',
      gridPos: { h: 8, w: 12, x: 12, y: 0 },
      targets: [{ expr: 'kalshi_endpoint_latency_ms{environment="demo"}', legendFormat: '{{endpoint}}' }],
    },
    {
      id: 3,
      title: 'Endpoint Up/Down (prod)',
      type: 'stat',
      gridPos: { h: 4, w: 12, x: 0, y: 8 },
      targets: [{ expr: 'kalshi_endpoint_up{environment="prod"}', legendFormat: '{{endpoint}}' }],
    },
    {
      id: 4,
      title: 'Exchange Active',
      type: 'stat',
      gridPos: { h: 4, w: 6, x: 12, y: 8 },
      targets: [{ expr: 'kalshi_exchange_active', legendFormat: '{{environment}}' }],
    },
    {
      id: 5,
      title: 'Overall Status',
      type: 'stat',
      gridPos: { h: 4, w: 6, x: 18, y: 8 },
      targets: [{ expr: 'kalshi_status_up', legendFormat: '{{environment}}' }],
    },
  ],
  time: { from: 'now-24h', to: 'now' },
  refresh: '1m',
};

const body = JSON.stringify({ dashboard, overwrite: true, folderId: 0 });

const res = await fetch(`${STACK_URL}/api/dashboards/db`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body,
});

const result = await res.json();
if (result.status === 'success') {
  const publicUrl = `${STACK_URL}/d/${result.uid}`;
  console.log('Dashboard created:', publicUrl);
  console.log('');
  console.log('Next: set PUBLIC_DASHBOARD_URL in wrangler.toml:');
  console.log(`  PUBLIC_DASHBOARD_URL = "${publicUrl}"`);
  console.log('');
  console.log('Then make the dashboard public in Grafana:');
  console.log('  Dashboard settings → Share → Public dashboards → Enable');
} else {
  console.error('Failed:', JSON.stringify(result, null, 2));
  process.exit(1);
}
