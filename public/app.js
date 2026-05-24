(function () {
  'use strict';

  const POLL_INTERVAL = 15_000;
  const SPARKLINE_SIZE = 10;
  const THEME_KEY = 'kalshi_theme';
  const ENV_KEY = 'kalshi_env';
  const THEMES = ['auto', 'light', 'dark'];

  let currentEnv = 'prod';
  let currentSnapshot = null;
  let historyMode = false;
  let historyTs = null;
  let historyList = [];
  let historyListEnv = null;
  let pollTimer = null;
  const sparkBuffers = new Map();

  const $ = (id) => document.getElementById(id);
  const $wordmarkDot = $('wordmark-dot');
  const $themeToggle = $('theme-toggle');
  const $envProd = $('env-prod');
  const $envDemo = $('env-demo');
  const $historyBar = $('history-mode-bar');
  const $histReturnLink = $('history-return-link');
  const $bannerDot = $('banner-dot');
  const $bannerText = $('banner-text');
  const $bannerAge = $('banner-age');
  const $bannerCron = $('banner-cron');
  const $exchangeContent = $('exchange-content');
  const $changelogHeader = $('changelog-header');
  const $changelogBody = $('changelog-body');
  const $endpointsHeader = $('endpoints-header');
  const $endpointsBody = $('endpoints-body');
  const $regionsContent = $('regions-content');
  const $wsContent = $('ws-content');
  const $histPrev = $('hist-prev');
  const $histTs = $('hist-ts');
  const $histNext = $('hist-next');
  const $histLive = $('hist-live');
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
    const next = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
    setTheme(next);
  }

  function initEnv() {
    const urlEnv = new URL(location.href).searchParams.get('env');
    currentEnv =
      urlEnv === 'prod' || urlEnv === 'demo' ? urlEnv : localStorage.getItem(ENV_KEY) || 'prod';
    updateEnvButtons();
  }
  function setEnv(env) {
    if (env === currentEnv) return;
    currentEnv = env;
    localStorage.setItem(ENV_KEY, env);
    updateEnvButtons();
    historyList = [];
    historyListEnv = null;
    sparkBuffers.clear();
    if (historyMode) exitHistory(false);
    fetchAndRender();
    fetchChangelog();
    updateTitle();
  }
  function updateEnvButtons() {
    $envProd.classList.toggle('active', currentEnv === 'prod');
    $envDemo.classList.toggle('active', currentEnv === 'demo');
  }

  function updateTitle() {
    const envTag = currentEnv === 'demo' ? ' [demo]' : '';
    const histTag = historyMode ? ' [history]' : '';
    document.title = `kalshistatus.dev${envTag}${histTag} — Kalshi API status`;
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

  function pushSparkline(key, ms) {
    if (!sparkBuffers.has(key)) sparkBuffers.set(key, []);
    const buf = sparkBuffers.get(key);
    buf.push(ms);
    if (buf.length > SPARKLINE_SIZE) buf.shift();
  }
  function renderSparklineHTML(buf) {
    const N = SPARKLINE_SIZE;
    const padded = Array(Math.max(0, N - buf.length))
      .fill(null)
      .concat(buf.slice(-N));
    const valid = padded.filter((v) => v != null);
    const maxVal = valid.length ? Math.max(...valid, 1) : 1;
    const colorMap = {
      fast: 'var(--status-operational)',
      slow: 'var(--status-degraded)',
      vslow: 'var(--status-down)',
      none: 'var(--border)',
    };
    return padded
      .map((v) => {
        const cls = latencyClass(v);
        const h = v != null ? Math.max(2, Math.round((v / maxVal) * 20)) : 2;
        return `<div class="sparkline-bar" style="height:${h}px;background:${colorMap[cls]}"></div>`;
      })
      .join('');
  }

  function renderStatus(snap) {
    const status = snap?.status ?? 'unknown';
    $wordmarkDot.className = `wordmark-dot ${status}`;
    $bannerDot.className = `banner-dot ${status}`;
    $bannerDot.setAttribute('aria-label', status);
    $bannerText.textContent = status.replace(/_/g, ' ');
    const ageMs = Date.now() - (snap?.ts ?? Date.now());
    $bannerAge.textContent = `updated ${formatAge(ageMs)} ago`;
    $bannerCron.textContent = historyMode ? 'snapshot view' : 'polling every 15s';
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
    for (const ep of endpoints) pushSparkline(ep.name, ep.latency_ms ?? null);

    const groups = [
      { title: 'Public', filter: (ep) => !ep.requires_auth },
      { title: 'Authenticated', filter: (ep) => ep.requires_auth },
    ];

    const rowHtml = (ep) => {
      const buf = sparkBuffers.get(ep.name) ?? [];
      const lCls = latencyClass(ep.latency_ms ?? null);
      const lText = latencyText(ep.latency_ms ?? null);
      const sCls = ['up', 'degraded', 'down', 'unknown'].includes(ep.status)
        ? ep.status
        : 'unknown';
      const noteHtml = ep.error ? `<div class="endpoint-error">${escHtml(ep.error)}</div>` : '';
      return `<div class="endpoint-row">
        <span class="endpoint-name">${escHtml(ep.name)}</span>
        <span class="endpoint-path" title="${escHtml(ep.url)}">${escHtml(endpointPath(ep))}</span>
        <div class="sparkline">${renderSparklineHTML(buf)}</div>
        <span class="latency ${lCls}">${lText}</span>
        <span class="endpoint-status ${sCls}">${escHtml(ep.status ?? '?')}</span>
      </div>${noteHtml}`;
    };

    const html = groups
      .map((g) => {
        const rows = endpoints.filter(g.filter).map(rowHtml).join('');
        if (!rows) return '';
        return `<div class="endpoint-group"><div class="endpoint-group-title">${g.title}</div>${rows}</div>`;
      })
      .join('');
    $endpointsBody.innerHTML = html;
  }

  function renderRegions(snap) {
    const regions = snap.regions ?? [];
    if (!regions.length) {
      $regionsContent.innerHTML =
        '<div class="ws-meta">No recent regional probes yet — best-effort sampling from request traffic.</div>';
      return;
    }
    const rows = regions.map((r) => {
      const ageMs = Date.now() - (r.probed_at ?? Date.now());
      const eps = (r.endpoints ?? []).filter((ep) => !ep.requires_auth);
      const upCount = eps.filter((ep) => ep.status === 'up').length;
      const avgLatency = eps.length
        ? Math.round(
            eps.reduce((s, ep) => s + (ep.latency_ms ?? 0), 0) /
              Math.max(1, eps.filter((ep) => ep.latency_ms != null).length),
          )
        : null;
      const cls = upCount === eps.length && eps.length > 0 ? 'connected' : 'disconnected';
      const latencyStr = avgLatency != null ? latencyText(avgLatency) : '—';
      return `<div class="ws-row">
        <span class="ws-channel">${escHtml(r.region)}</span>
        <span class="ws-count">${escHtml(`${upCount}/${eps.length}`)} up</span>
        <span class="ws-latency latency ${latencyClass(avgLatency)}">${latencyStr}</span>
        <span class="ws-status ${cls}">${formatAge(ageMs)} ago</span>
      </div>`;
    });
    $regionsContent.innerHTML = rows.join('');
  }

  function renderWs(snap) {
    const ws = snap.ws_sample;
    if (!ws) {
      $wsContent.innerHTML = '<div class="ws-meta">No WebSocket data</div>';
      return;
    }
    const sCls = ws.connected ? 'connected' : 'disconnected';
    const sText = ws.connected ? 'connected' : 'disconnected';
    const lText = latencyText(ws.latency_ms ?? null);
    const lCls = latencyClass(ws.latency_ms ?? null);
    const sampledAgo = formatAge(Date.now() - (ws.sampled_at ?? Date.now()));
    const tickersRx = escHtml(String(ws.tickers_received ?? 0));
    const errNote = ws.error ? `<div class="error-text">${escHtml(ws.error)}</div>` : '';
    $wsContent.innerHTML = `
      <div class="ws-meta">sampled ${sampledAgo} ago · ${tickersRx} tickers received</div>
      <div class="ws-row">
        <span class="ws-channel">orderbook_delta</span>
        <span class="ws-count">${tickersRx}</span>
        <span class="ws-latency latency ${lCls}">${lText}</span>
        <span class="ws-status ${sCls}">${sText}</span>
      </div>${errNote}`;
  }

  async function fetchChangelog() {
    const res = await fetch(`/api/changelog?env=${currentEnv}&limit=20`);
    if (!res.ok) {
      $changelogBody.innerHTML = '<div class="error-text">Failed to load changelog</div>';
      return;
    }
    const entries = await res.json();
    if (!Array.isArray(entries) || entries.length === 0) {
      $changelogBody.innerHTML = '<div class="loading-text">No changelog entries yet</div>';
      return;
    }
    const items = entries.map((e) => {
      const date = new Date(e.pub_date_ts).toISOString().slice(0, 10);
      return `<div class="changelog-item">
        <div class="changelog-title">
          <a href="${escHtml(e.link)}" target="_blank" rel="noopener noreferrer">${escHtml(e.title)}</a>
        </div>
        <div class="changelog-summary">${escHtml(e.summary_ai)}</div>
        <div class="changelog-meta">${date}</div>
      </div>`;
    });
    $changelogBody.innerHTML = items.join('');
  }

  function renderAll(snap) {
    currentSnapshot = snap;
    renderStatus(snap);
    renderExchange(snap);
    renderEndpoints(snap);
    renderRegions(snap);
    renderWs(snap);
    updateHistoryControls();
  }

  async function fetchSnapshot(ts) {
    let url = `/api/status?env=${currentEnv}`;
    if (ts != null) url += `&at=${ts}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.error ? null : data;
  }

  async function fetchAndRender() {
    const snap = await fetchSnapshot(historyMode ? historyTs : null);
    if (snap) renderAll(snap);
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(fetchAndRender, POLL_INTERVAL);
  }
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function ensureHistoryList() {
    if (historyListEnv === currentEnv && historyList.length > 0) return;
    const res = await fetch(`/api/history?env=${currentEnv}&limit=1440`);
    if (!res.ok) return;
    const list = await res.json();
    historyList = list.map((s) => s.ts).sort((a, b) => a - b);
    historyListEnv = currentEnv;
  }

  function enterHistory(ts) {
    historyMode = true;
    historyTs = ts;
    stopPolling();
    $historyBar.classList.add('active');
    $histLive.style.display = '';
    updateTitle();
    updateHistoryControls();
    fetchAndRender();
  }

  function exitHistory(refetch = true) {
    historyMode = false;
    historyTs = null;
    $historyBar.classList.remove('active');
    $histLive.style.display = 'none';
    $histTs.textContent = 'live';
    $histPrev.disabled = false;
    $histNext.disabled = true;
    updateTitle();
    const url = new URL(location.href);
    url.searchParams.delete('at');
    history.replaceState(null, '', url);
    startPolling();
    if (refetch) fetchAndRender();
  }

  function updateHistoryControls() {
    if (!historyMode) {
      $histTs.textContent = 'live';
      $histPrev.disabled = false;
      $histNext.disabled = true;
      return;
    }
    $histTs.textContent = historyTs ? new Date(historyTs).toLocaleString() : '—';
    if (historyList.length) {
      const idx = historyList.indexOf(historyTs);
      $histPrev.disabled = idx <= 0;
      $histNext.disabled = idx < 0 || idx >= historyList.length - 1;
    } else {
      $histPrev.disabled = true;
      $histNext.disabled = true;
    }
  }

  async function navHistory(direction) {
    await ensureHistoryList();

    if (!historyMode) {
      const ref = currentSnapshot?.ts ?? Date.now();
      let ts = null;
      for (let i = historyList.length - 1; i >= 0; i--) {
        if (historyList[i] < ref) {
          ts = historyList[i];
          break;
        }
      }
      if (ts == null && historyList.length)
        ts = historyList[historyList.length - 2] ?? historyList[0];
      if (ts == null) ts = ref - 5 * 60 * 1000;
      const url = new URL(location.href);
      url.searchParams.set('at', ts);
      history.pushState(null, '', url);
      enterHistory(ts);
      return;
    }

    if (historyList.length) {
      const idx = historyList.indexOf(historyTs);
      const newIdx = direction === 'prev' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= historyList.length) return;
      historyTs = historyList[newIdx];
    } else {
      historyTs = historyTs + (direction === 'prev' ? -5 * 60 * 1000 : 5 * 60 * 1000);
    }
    const url = new URL(location.href);
    url.searchParams.set('at', historyTs);
    history.pushState(null, '', url);
    updateHistoryControls();
    fetchAndRender();
  }

  function initCollapsible(header, body, startOpen) {
    const card = header.closest('.card');
    function applyState(open) {
      body.classList.toggle('hidden', !open);
      if (card) card.classList.toggle('collapsed', !open);
      header.setAttribute('aria-expanded', String(open));
    }
    applyState(startOpen);
    function toggle() {
      applyState(body.classList.contains('hidden'));
    }
    header.addEventListener('click', toggle);
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
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

    initEnv();
    $envProd.addEventListener('click', () => setEnv('prod'));
    $envDemo.addEventListener('click', () => setEnv('demo'));

    initCollapsible($changelogHeader, $changelogBody, false);
    initCollapsible($endpointsHeader, $endpointsBody, true);

    $histPrev.addEventListener('click', () => navHistory('prev'));
    $histNext.addEventListener('click', () => navHistory('next'));
    $histLive.addEventListener('click', (e) => {
      e.preventDefault();
      exitHistory();
    });
    $histReturnLink.addEventListener('click', (e) => {
      e.preventDefault();
      exitHistory();
    });

    document.addEventListener('keydown', (e) => {
      if (
        e.target &&
        (e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.isContentEditable)
      )
        return;
      if (e.key === 'ArrowLeft') navHistory('prev');
      if (e.key === 'ArrowRight' && historyMode) navHistory('next');
    });

    const atParam = new URL(location.href).searchParams.get('at');
    if (atParam) {
      const ts = parseInt(atParam, 10);
      if (Number.isFinite(ts) && ts > 0) {
        historyMode = true;
        historyTs = ts;
        $historyBar.classList.add('active');
        $histLive.style.display = '';
        updateTitle();
      }
    }

    fetchAndRender();
    fetchChangelog();
    if (!historyMode) startPolling();
    fetchVersion();
    updateTitle();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
