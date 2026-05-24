#!/usr/bin/env node
/**
 * Grafana dashboard provisioning — idempotent, safe to run on every deploy.
 * Run: GRAFANA_STACK_URL=https://<stack>.grafana.net GRAFANA_SA_TOKEN=<token> node scripts/grafana-setup.mjs
 */

const STACK_URL = process.env.GRAFANA_STACK_URL?.replace(/\/$/, '');
const TOKEN = process.env.GRAFANA_SA_TOKEN;

if (!STACK_URL || !TOKEN) {
  console.error('Set GRAFANA_STACK_URL and GRAFANA_SA_TOKEN');
  process.exit(1);
}

const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

const dashboard = {
  title: 'Kalshi API Status',
  panels: [
    {
      id: 1,
      title: 'Endpoint Latency (prod)',
      type: 'timeseries',
      gridPos: { h: 8, w: 12, x: 0, y: 0 },
      targets: [
        { expr: 'kalshi_endpoint_latency_ms{environment="prod"}', legendFormat: '{{endpoint}}' },
      ],
    },
    {
      id: 2,
      title: 'Endpoint Latency (demo)',
      type: 'timeseries',
      gridPos: { h: 8, w: 12, x: 12, y: 0 },
      targets: [
        { expr: 'kalshi_endpoint_latency_ms{environment="demo"}', legendFormat: '{{endpoint}}' },
      ],
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

// Step 1: create/update dashboard
const createRes = await fetch(`${STACK_URL}/api/dashboards/db`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ dashboard, overwrite: true, folderId: 0 }),
});

const created = await createRes.json();
if (created.status !== 'success') {
  console.error('Dashboard creation failed:', JSON.stringify(created, null, 2));
  process.exit(1);
}

const uid = created.uid;
console.log('Dashboard created/updated, uid:', uid);

// Step 2: check for existing public dashboard to keep URL stable across re-runs
const getRes = await fetch(`${STACK_URL}/api/dashboards/uid/${uid}/public-dashboards`, {
  headers,
});
const existing = await getRes.json();

let accessToken;

if (existing.accessToken) {
  accessToken = existing.accessToken;
  if (!existing.isEnabled && existing.uid) {
    await fetch(`${STACK_URL}/api/dashboards/uid/${uid}/public-dashboards/${existing.uid}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ isEnabled: true }),
    });
    console.log('Re-enabled existing public dashboard.');
  } else {
    console.log('Reusing existing public dashboard.');
  }
} else {
  const pubRes = await fetch(`${STACK_URL}/api/dashboards/uid/${uid}/public-dashboards`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ isEnabled: true }),
  });

  const pub = await pubRes.json();
  if (!pub.accessToken) {
    console.error('Public dashboard creation failed:', JSON.stringify(pub, null, 2));
    process.exit(1);
  }
  accessToken = pub.accessToken;
}

const publicUrl = `${STACK_URL}/public-dashboards/${accessToken}`;
console.log('');
console.log('PUBLIC URL:', publicUrl);
console.log('');
console.log('Set in wrangler.toml:');
console.log(`  PUBLIC_DASHBOARD_URL = "${publicUrl}"`);
