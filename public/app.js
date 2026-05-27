(function () {
  'use strict';

  const POLL_INTERVAL = 30_000;
  const THEME_KEY = 'kalshi_theme';
  const THEMES = ['auto', 'light', 'dark'];

  const $ = (id) => document.getElementById(id);
  const $wordmarkDot = $('wordmark-dot');
  const $themeToggle = $('theme-toggle');
  const $bannerDot = $('banner-dot');
  const $bannerText = $('banner-text');
  const $bannerAge = $('banner-age');
  const $bannerCron = $('banner-cron');
  const $bannerUptime = $('banner-uptime');
  const $latencyChart = $('latency-chart');
  const $latencyMeta = $('latency-meta');
  const $exchangeContent = $('exchange-content');
  const $endpointsBody = $('endpoints-body');
  const $footerVersion = $('footer-version');

  function getTheme() {
    return localStorage.getItem(THEME_KEY) || 'auto';
  }
  function setTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
    $themeToggle.textContent = theme;
    $themeToggle.setAttribute('aria-label', `Color theme: ${theme}`);
  }
  function cycleTheme() {
    setTheme(THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length]);
  }

  function latencyClass(ms) {
    if (ms == null) return 'none';
    if (ms < 500) return 'fast';
    if (ms < 2000) return 'slow';
    return 'vslow';
  }
  function latencyText(ms) {
    if (ms == null) return '—';
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  }
  function formatAge(ms) {
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
    return `${Math.round(ms / 3_600_000)}h`;
  }
  function escHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  }
  function endpointPath(ep) {
    try {
      const u = new URL(ep.url);
      return u.pathname + u.search;
    } catch {
      return ep.url || '';
    }
  }

  function uptimeClass(pct) {
    if (pct >= 99.9) return '';
    if (pct >= 99) return 'degraded';
    if (pct > 0) return 'down';
    return 'unknown';
  }

  function renderUptime(uptime) {
    if (!uptime) {
      $bannerUptime.innerHTML = '';
      return;
    }
    const order = [
      ['24h', '24h'],
      ['7d', '7d'],
      ['30d', '30d'],
    ];
    $bannerUptime.innerHTML = order
      .filter(([k]) => uptime[k])
      .map(([k, label]) => {
        const w = uptime[k];
        const pct = Number(w.pct);
        const display = w.total_count === 0 ? '—' : `${pct.toFixed(pct >= 99.99 ? 2 : 1)}%`;
        return `<div class="uptime-window"><span class="uptime-window-pct ${uptimeClass(pct)}">${display}</span><span class="uptime-window-label">${label}</span></div>`;
      })
      .join('');
  }

  function renderStatus(snap) {
    const status = snap.status ?? 'unknown';
    $wordmarkDot.className = `wordmark-dot ${status}`;
    $bannerDot.className = `banner-dot ${status}`;
    $bannerDot.setAttribute('aria-label', status);
    $bannerText.textContent = status.replace(/_/g, ' ');
    $bannerAge.textContent = `updated ${formatAge(Date.now() - (snap.ts ?? Date.now()))} ago`;
    $bannerCron.textContent = 'polling every 30s';
    renderUptime(snap.uptime);
  }

  function renderExchange(snap) {
    const ex = snap.exchange ?? {};
    const pills = [
      { label: 'exchange', val: ex.exchange_active },
      { label: 'trading', val: ex.trading_active },
    ].map(({ label, val }) => {
      const cls = val === true ? 'operational' : val === false ? 'down' : 'unknown';
      const text = val === true ? 'yes' : val === false ? 'no' : '?';
      return `<span class="status-pill ${cls}"><span class="dot">●</span>${escHtml(label)}: ${text}</span>`;
    });
    $exchangeContent.innerHTML = `<div class="exchange-indicators">${pills.join('')}</div>`;
  }

  function renderEndpoints(snap) {
    const endpoints = snap.endpoints ?? [];
    if (!endpoints.length) {
      $endpointsBody.innerHTML = '<div class="loading-text">No endpoint data</div>';
      return;
    }
    $endpointsBody.innerHTML = endpoints
      .map((ep) => {
        const sCls = ['up', 'degraded', 'down', 'unknown'].includes(ep.status) ? ep.status : 'unknown';
        const noteHtml = ep.error ? `<div class="endpoint-error">${escHtml(ep.error)}</div>` : '';
        return `<div class="endpoint-row">
          <span class="endpoint-name">${escHtml(ep.name)}</span>
          <span class="endpoint-path" title="${escHtml(ep.url)}">${escHtml(endpointPath(ep))}</span>
          <span class="latency ${latencyClass(ep.latency_ms ?? null)}">${latencyText(ep.latency_ms ?? null)}</span>
          <span class="endpoint-status ${sCls}">${escHtml(ep.status ?? '?')}</span>
        </div>${noteHtml}`;
      })
      .join('');
  }

  function renderLatencyChart(series) {
    const points = (series ?? []).filter((p) => p.latency_ms != null);
    if (points.length < 2) {
      $latencyChart.innerHTML = '<div class="latency-chart-empty">Collecting data…</div>';
      $latencyMeta.textContent = '';
      return;
    }
    const W = 1000;
    const H = 160;
    const padding = { left: 38, right: 8, top: 12, bottom: 22 };
    const innerW = W - padding.left - padding.right;
    const innerH = H - padding.top - padding.bottom;
    const tsMin = points[0].ts;
    const tsMax = points[points.length - 1].ts;
    const tsRange = Math.max(1, tsMax - tsMin);
    const latencies = points.map((p) => p.latency_ms);
    const yNice = Math.ceil(Math.max(...latencies, 100) / 100) * 100;
    const x = (ts) => padding.left + ((ts - tsMin) / tsRange) * innerW;
    const y = (l) => padding.top + (1 - l / yNice) * innerH;

    const lineD =
      `M${x(points[0].ts).toFixed(1)},${y(points[0].latency_ms).toFixed(1)} ` +
      points.slice(1).map((p) => `L${x(p.ts).toFixed(1)},${y(p.latency_ms).toFixed(1)}`).join(' ');
    const areaD =
      `M${x(points[0].ts).toFixed(1)},${y(0).toFixed(1)} ` +
      points.map((p) => `L${x(p.ts).toFixed(1)},${y(p.latency_ms).toFixed(1)}`).join(' ') +
      ` L${x(points[points.length - 1].ts).toFixed(1)},${y(0).toFixed(1)} Z`;

    const yTicks = [0, yNice / 2, yNice];
    const gridlines = yTicks
      .map((t) => `<line class="latency-gridline" x1="${padding.left}" x2="${W - padding.right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" />`)
      .join('');
    const yLabels = yTicks
      .map((t) => `<text class="latency-axis" x="${padding.left - 6}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end">${t}ms</text>`)
      .join('');
    const xTickCount = 4;
    const xLabels = Array.from({ length: xTickCount + 1 }, (_, i) => {
      const ts = tsMin + (i * tsRange) / xTickCount;
      const d = new Date(ts);
      const label = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
      const anchor = i === 0 ? 'start' : i === xTickCount ? 'end' : 'middle';
      return `<text class="latency-axis" x="${x(ts).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}">${label}</text>`;
    }).join('');

    $latencyChart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Average public endpoint latency over the last 24 hours">${gridlines}<path class="latency-area" d="${areaD}" /><path class="latency-line" d="${lineD}" />${yLabels}${xLabels}</svg>`;

    const avg = Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length);
    const p95 = latencies.slice().sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)] ?? null;
    $latencyMeta.textContent = `avg ${avg}ms · p95 ${p95}ms · ${points.length} samples`;
  }

  async function fetchStatus() {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const snap = await res.json();
    if (snap.error) return;
    renderStatus(snap);
    renderExchange(snap);
    renderEndpoints(snap);
  }

  async function fetchHistory() {
    const res = await fetch('/api/history?window=24h');
    if (!res.ok) {
      $latencyChart.innerHTML = '<div class="latency-chart-empty">Failed to load history</div>';
      return;
    }
    const { series } = await res.json();
    renderLatencyChart(series);
  }

  async function fetchVersion() {
    const res = await fetch('/api/version');
    if (!res.ok) return;
    const data = await res.json();
    const parts = [];
    if (data.version) parts.push(`v${data.version}`);
    if (data.commit) parts.push(`@${String(data.commit).slice(0, 7)}`);
    if (parts.length) $footerVersion.textContent = parts.join(' · ');
  }

  function init() {
    setTheme(getTheme());
    $themeToggle.addEventListener('click', cycleTheme);
    fetchStatus();
    fetchHistory();
    fetchVersion();
    setInterval(fetchStatus, POLL_INTERVAL);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
