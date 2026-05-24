const GRAFANA_STACK_URL = 'https://shipman.grafana.net';
// Simple call guard — this endpoint is temporary and will be removed after initial setup
const INIT_GUARD = 'kalshi-grafana-init-2026';

const DASHBOARD_DEF = {
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

interface DashboardCreateResult {
  status?: string;
  uid?: string;
}

interface PublicDashboardResult {
  accessToken?: string;
  isEnabled?: boolean;
  uid?: string;
}

export async function handleGrafanaInit(
  request: Request,
  token: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const key = new URL(request.url).searchParams.get('key');
  if (key !== INIT_GUARD) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!token) {
    return Response.json({ error: 'GRAFANA_API_TOKEN not configured' }, { status: 500 });
  }

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const createRes = await fetchFn(`${GRAFANA_STACK_URL}/api/dashboards/db`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ dashboard: DASHBOARD_DEF, overwrite: true, folderId: 0 }),
  });
  const created = (await createRes.json()) as DashboardCreateResult;
  if (created.status !== 'success' || !created.uid) {
    return Response.json({ error: 'dashboard creation failed', detail: created }, { status: 500 });
  }

  const uid = created.uid;

  // Check for existing public dashboard first to keep the URL stable across re-runs
  const getRes = await fetchFn(
    `${GRAFANA_STACK_URL}/api/dashboards/uid/${uid}/public-dashboards`,
    { headers },
  );
  const existing = (await getRes.json()) as PublicDashboardResult;

  let accessToken: string;

  if (existing.accessToken) {
    accessToken = existing.accessToken;
    if (!existing.isEnabled && existing.uid) {
      await fetchFn(
        `${GRAFANA_STACK_URL}/api/dashboards/uid/${uid}/public-dashboards/${existing.uid}`,
        { method: 'PATCH', headers, body: JSON.stringify({ isEnabled: true }) },
      );
    }
  } else {
    const pubRes = await fetchFn(
      `${GRAFANA_STACK_URL}/api/dashboards/uid/${uid}/public-dashboards`,
      { method: 'POST', headers, body: JSON.stringify({ isEnabled: true }) },
    );
    const pub = (await pubRes.json()) as PublicDashboardResult;
    if (!pub.accessToken) {
      return Response.json({ error: 'public dashboard creation failed', detail: pub }, { status: 500 });
    }
    accessToken = pub.accessToken;
  }

  return Response.json({ url: `${GRAFANA_STACK_URL}/public-dashboards/${accessToken}`, uid });
}
