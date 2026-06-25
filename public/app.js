'use strict';

// Dashboard client. Subscribes to the SSE stream and renders live state.
// All trading happens server-side (paper); this is view + control only.

const $ = (sel) => document.querySelector(sel);
const fmt = (n, d = 2) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const usd = (n) => (n < 0 ? '-$' : '$') + fmt(Math.abs(n));
const signed = (n) => (n >= 0 ? '+' : '') + fmt(n);
const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

let state = null;

/* ---- rendering ---- */
function render(s) {
  state = s;

  // header
  $('#equity').textContent = usd(s.account.equity);
  const pnlEl = $('#pnl');
  pnlEl.textContent = `${signed(s.account.totalPnl)} (${signed(s.account.returnPct)}%)`;
  pnlEl.className = 'equity-pnl ' + cls(s.account.totalPnl);

  const srcEl = $('#source');
  srcEl.textContent = s.source;
  srcEl.className = 'pill ' + s.source;

  const modeEl = $('#mode');
  const live = s.mode === 'live';
  modeEl.textContent = live ? 'LIVE' : 'PAPER';
  modeEl.className = 'pill ' + (live ? 'live-mode' : 'paper-mode');
  modeEl.title = live ? (s.liveAddress || 'real funds') : 'simulation';
  document.body.classList.toggle('is-live', live);

  const info = $('#liveinfo');
  if (live) {
    const addr = s.liveAddress ? s.liveAddress.slice(0, 6) + '…' + s.liveAddress.slice(-4) : 'wallet';
    const ago = s.liveSyncTs ? Math.max(0, Math.round((Date.now() - s.liveSyncTs) / 1000)) + 's ago' : 'never';
    info.textContent = `● Real wallet ${addr} · on-chain synced ${ago}`;
    info.style.display = 'block';
  } else {
    info.style.display = 'none';
  }

  const runBtn = $('#toggleRun');
  runBtn.textContent = s.running ? 'Stop' : 'Start';
  runBtn.classList.toggle('running', s.running);

  renderStrategies(s.enabled);
  renderReadiness(s.performance, s.source);
  pushChartPoint(s);
  drawChart(s.account.startingBalance);
  renderStats(s.account);
  renderMarkets(s.markets);
  renderPositions(s.positions);
  renderActivity(s.trades, s.signals);
  renderCopy(s.leaderboard, s.copyWallets);
  renderSettings(s);
}

function renderSettings(s) {
  // Reflect current source + connection without touching the input fields.
  document.querySelectorAll('#sourceSeg .seg-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.source === s.source));
  $('#sourceStatus').textContent = `Currently: ${s.source}` +
    (s.mode === 'live' && s.source === 'mock' ? ' — ⚠ trading live against simulated prices' : '');

  const live = s.mode === 'live';
  $('#connStatus').textContent = live
    ? `Connected: ${s.liveAddress} (live)`
    : 'Not connected (paper mode)';
  $('#connStatus').className = 'sub ' + (live ? 'neg' : '');
  $('#connectForm').style.display = live ? 'none' : 'block';
  $('#disconnectBtn').style.display = live ? 'block' : 'none';
}

function renderStrategies(enabled) {
  const labels = { takeProfit: 'Take-Profit', marketMaker: 'Market-Make', arbitrage: 'Arb', momentum: 'Momentum', copyTrade: 'Copy' };
  $('#strategies').innerHTML = Object.entries(enabled)
    .map(([k, v]) => `<button class="strat-toggle ${v ? 'on' : ''}" data-strat="${k}">${labels[k] || k}</button>`)
    .join('');
}

/* ---- live chart ---- */
let chartData = []; // [{ t, e, r }]
let chartMetric = 'equity';

function pushChartPoint(s) {
  const last = chartData[chartData.length - 1];
  if (last && last.t === s.ts) return;
  chartData.push({ t: s.ts, e: s.account.equity, r: s.account.realizedPnl });
  if (chartData.length > 600) chartData.shift();
}

function drawChart(startingBalance) {
  const svg = $('#chart');
  const W = 100, H = 36;
  const realized = chartMetric === 'realized';
  const vals = chartData.map((p) => (realized ? p.r : p.e));
  const baseline = realized ? 0 : startingBalance;

  if (vals.length < 2) { svg.innerHTML = ''; $('#chartNow').textContent = ''; return; }

  let min = Math.min(...vals, baseline);
  let max = Math.max(...vals, baseline);
  if (max - min < 1e-6) { max += 0.5; min -= 0.5; }
  const pad = (max - min) * 0.1; min -= pad; max += pad;

  const x = (i) => (i / (vals.length - 1)) * W;
  const y = (v) => H - ((v - min) / (max - min)) * H;
  const pts = vals.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`);
  const line = `M${pts.join(' L')}`;
  const area = `M${x(0).toFixed(2)},${H} L${pts.join(' L')} L${x(vals.length - 1).toFixed(2)},${H} Z`;
  const cur = vals[vals.length - 1];
  const up = cur >= baseline;
  const stroke = up ? 'var(--green)' : 'var(--red)';
  const fill = up ? 'rgba(46,204,113,.13)' : 'rgba(255,84,112,.13)';
  const by = y(baseline).toFixed(2);

  svg.innerHTML =
    `<line class="chart-base" x1="0" y1="${by}" x2="100" y2="${by}"></line>` +
    `<path d="${area}" fill="${fill}" stroke="none"></path>` +
    `<path d="${line}" fill="none" stroke="${stroke}" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-linejoin="round"></path>`;

  const delta = cur - baseline;
  $('#chartNow').innerHTML = realized
    ? `<span class="${cls(cur)}">${signed(cur)}</span>`
    : `${usd(cur)} <span class="${cls(delta)}">${signed(delta)}</span>`;
}

$('#chartSeg').onclick = (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  chartMetric = b.dataset.metric;
  document.querySelectorAll('#chartSeg .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
  if (state) drawChart(state.account.startingBalance);
};

function renderReadiness(p, source) {
  if (!p) return;
  const el = $('#readiness');
  const wr = (p.winRate * 100).toFixed(0);
  const dataNote = source === 'live' ? 'real market data' : 'mock data — switch source to Live for a real test';
  let cls, text;
  if (p.readiness === 'ready') {
    cls = 'ready';
    text = `✓ Consistently profitable — ${p.closed} trades, ${wr}% win, ${signed(p.realizedPnl)}. Ready to go live → open ⚙ to connect a wallet.`;
  } else if (p.readiness === 'not_ready') {
    cls = 'notready';
    text = `Not consistent yet — ${p.closed} trades, ${wr}% win, ${signed(p.realizedPnl)} realized. Keep evaluating (${dataNote}).`;
  } else {
    cls = 'building';
    text = `Evaluating strategy… ${p.closed}/${p.needTrades} closed trades (${dataNote}).`;
  }
  el.className = 'readiness ' + cls;
  el.textContent = text;
}

function renderStats(a) {
  const items = [
    ['Cash', usd(a.cash)],
    ['Deployed', usd(a.positionsValue)],
    ['Exposure', usd(a.exposure)],
    ['Realized', usd(a.realizedPnl), cls(a.realizedPnl)],
    ['Unrealized', usd(a.unrealizedPnl), cls(a.unrealizedPnl)],
    ['Start', usd(a.startingBalance)],
  ];
  $('#stats').innerHTML = items
    .map(([k, v, c]) => `<div class="stat"><div class="k">${k}</div><div class="v ${c || ''}">${v}</div></div>`)
    .join('');
}

function renderMarkets(markets) {
  if (!markets.length) return ($('#panel-markets').innerHTML = '<div class="empty">No markets</div>');
  $('#panel-markets').innerHTML = markets
    .map((m) => {
      const arb = m.arbEdge > 0.005 ? `<span class="badge-arb">ARB ${(m.arbEdge * 100).toFixed(1)}%</span>` : '';
      return `<div class="card">
        <div class="q">${esc(m.question)}${arb}</div>
        <div class="quotes">
          <div class="quote yes" data-mkt="${m.id}" data-outcome="YES"><div class="lbl">YES · buy</div><div class="px">${(m.yesAsk * 100).toFixed(1)}¢</div></div>
          <div class="quote no" data-mkt="${m.id}" data-outcome="NO"><div class="lbl">NO · buy</div><div class="px">${(m.noAsk * 100).toFixed(1)}¢</div></div>
        </div>
      </div>`;
    })
    .join('');
}

function renderPositions(positions) {
  if (!positions.length) return ($('#panel-positions').innerHTML = '<div class="empty">No open positions</div>');
  $('#panel-positions').innerHTML = '<div class="card">' + positions
    .map((p) => `<div class="row">
        <div class="left">
          <div class="name">${esc(p.question)}</div>
          <div class="sub">${p.outcome} · ${fmt(p.shares, 1)} sh @ ${(p.avgPrice * 100).toFixed(1)}¢ → ${(p.mark * 100).toFixed(1)}¢</div>
        </div>
        <div class="right">
          <div>${usd(p.value)}</div>
          <div class="sub ${cls(p.unrealizedPnl)}">${signed(p.unrealizedPnl)}</div>
        </div>
      </div>`)
    .join('') + '</div>';
}

function renderActivity(trades, signals) {
  const time = (ts) => new Date(ts).toLocaleTimeString('en-US', { hour12: false });
  const tradeRows = trades.length
    ? trades.map((t) => `<div class="row">
        <div class="left"><div class="name">${esc(t.question)}</div>
          <div class="sub"><span class="tag ${t.side.toLowerCase()}">${t.side} ${t.outcome}</span> ${t.strategy} · ${time(t.ts)}</div></div>
        <div class="right"><div>${fmt(t.shares, 1)} sh</div><div class="sub">@ ${(t.price * 100).toFixed(1)}¢</div></div>
      </div>`).join('')
    : '<div class="empty">No fills yet</div>';

  const sigRows = signals.length
    ? signals.slice(0, 15).map((g) => `<div class="row">
        <div class="left"><div class="name">${esc(g.reason || g.strategy)}</div>
          <div class="sub">${g.strategy} · ${time(g.ts)}</div></div>
        <div class="right"><span class="tag ${g.status}">${g.status}</span><div class="sub">${esc(g.detail || '')}</div></div>
      </div>`).join('')
    : '<div class="empty">No signals yet</div>';

  $('#panel-activity').innerHTML =
    `<div class="card"><div class="q">Fills</div>${tradeRows}</div>` +
    `<div class="card"><div class="q">Signals</div>${sigRows}</div>`;
}

function renderCopy(leaderboard, copyWallets) {
  const tracked = new Set(copyWallets);
  if (!leaderboard.length) return ($('#panel-copy').innerHTML = '<div class="empty">No leaderboard data</div>');
  $('#panel-copy').innerHTML = '<div class="card"><div class="q">Leaderboard — tracked wallets are mirrored</div>' +
    leaderboard.map((t) => `<div class="row">
        <div class="left"><div class="name">${esc(t.name)} ${tracked.has(t.wallet) ? '<span class="tag filled">copying</span>' : ''}</div>
          <div class="sub">${t.wallet.slice(0, 10)}…</div></div>
        <div class="right pos">${usd(t.pnl)}</div>
      </div>`).join('') + '</div>';
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---- controls ---- */
async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

$('#toggleRun').onclick = () => post('/api/control', { action: state && state.running ? 'stop' : 'start' });
$('#flatten').onclick = () => { post('/api/control', { action: 'flatten' }); toast('Flattening positions'); };
$('#reset').onclick = () => { if (confirm('Reset paper account?')) { post('/api/control', { action: 'reset' }); toast('Account reset'); } };

document.addEventListener('click', (e) => {
  const strat = e.target.closest('.strat-toggle');
  if (strat) {
    const k = strat.dataset.strat;
    post('/api/strategies', { [k]: !state.enabled[k] });
    return;
  }
  const tab = e.target.closest('.tab');
  if (tab) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + tab.dataset.tab));
    return;
  }
  const srcBtn = e.target.closest('#sourceSeg .seg-btn');
  if (srcBtn) {
    toast(`Switching to ${srcBtn.dataset.source}…`);
    post('/api/source', { source: srcBtn.dataset.source }).then((r) => {
      if (!r.ok) toast(`Source: ${r.error || 'switch failed'}`);
    });
    return;
  }
  const quote = e.target.closest('.quote');
  if (quote) openSheet(quote.dataset.mkt, quote.dataset.outcome);
});

$('#connectBtn').onclick = async () => {
  const privateKey = $('#pkInput').value.trim();
  if (!privateKey) return toast('Enter a private key');
  $('#connectBtn').textContent = 'Connecting…';
  const res = await post('/api/connect', {
    privateKey,
    funderAddress: $('#funderInput').value.trim(),
    signatureType: $('#sigInput').value,
  });
  $('#pkInput').value = ''; // clear from the DOM immediately
  $('#connectBtn').textContent = 'Connect wallet';
  toast(res.ok ? `Connected ${res.address.slice(0, 6)}…` : `Connect failed: ${res.error}`);
};

$('#disconnectBtn').onclick = async () => {
  if (!confirm('Disconnect wallet and return to paper mode?')) return;
  await post('/api/disconnect', {});
  toast('Disconnected — paper mode');
};

/* ---- trade sheet ---- */
let sheet = { marketId: null, outcome: 'YES', side: 'BUY' };
function openSheet(marketId, outcome) {
  const m = state.markets.find((x) => x.id === marketId);
  if (!m) return;
  sheet = { marketId, outcome, side: 'BUY' };
  $('#sheetTitle').textContent = m.question;
  setSeg('#outcomeSeg', 'outcome', outcome);
  setSeg('#sideSeg', 'side', 'BUY');
  updateSheetQuote();
  $('#tradeSheet').classList.add('show');
  $('#sheetBackdrop').classList.add('show');
}
function closeSheet() {
  $('#tradeSheet').classList.remove('show');
  $('#sheetBackdrop').classList.remove('show');
}
function setSeg(sel, key, val) {
  document.querySelectorAll(`${sel} .seg-btn`).forEach((b) => b.classList.toggle('active', b.dataset[key] === val));
  sheet[key] = val;
}
function updateSheetQuote() {
  const m = state.markets.find((x) => x.id === sheet.marketId);
  if (!m) return;
  const px = sheet.side === 'BUY'
    ? (sheet.outcome === 'YES' ? m.yesAsk : m.noAsk)
    : (sheet.outcome === 'YES' ? m.yesBid : m.noBid);
  $('#sheetQuote').textContent = `${sheet.side} ${sheet.outcome} @ ${(px * 100).toFixed(1)}¢`;
}
$('#sideSeg').onclick = (e) => { const b = e.target.closest('.seg-btn'); if (b) { setSeg('#sideSeg', 'side', b.dataset.side); updateSheetQuote(); } };
$('#outcomeSeg').onclick = (e) => { const b = e.target.closest('.seg-btn'); if (b) { setSeg('#outcomeSeg', 'outcome', b.dataset.outcome); updateSheetQuote(); } };
$('#cancelOrder').onclick = closeSheet;
$('#sheetBackdrop').onclick = closeSheet;
$('#submitOrder').onclick = async () => {
  const sizeUsd = Number($('#sizeInput').value);
  const res = await post('/api/order', { marketId: sheet.marketId, outcome: sheet.outcome, side: sheet.side, sizeUsd });
  toast(res.ok ? `Filled ${res.trade.shares.toFixed(1)} @ ${(res.trade.price * 100).toFixed(1)}¢` : `Rejected: ${res.error}`);
  if (res.ok) closeSheet();
};

/* ---- live stream ---- */
let stream = null;
function connect() {
  if (stream) return;
  const es = new EventSource('/api/stream');
  stream = es;
  es.addEventListener('update', (e) => render(JSON.parse(e.data)));
  es.addEventListener('sourceTrade', (e) => {
    const t = JSON.parse(e.data);
    toast(`${t.trader}: ${t.side} ${t.outcome} $${Math.round(t.sizeUsd)}`);
  });
  es.onerror = async () => {
    // Could be a normal reconnect or an expired session — re-check auth.
    const a = await fetch('/api/auth').then((r) => r.json()).catch(() => null);
    if (a && a.required && !a.authed) { es.close(); stream = null; showLock(); }
  };
}

/* ---- auth gate ---- */
let authRequired = false;
function showLock() {
  $('#lockScreen').classList.add('show');
  $('#pinInput').focus();
}
function hideLock() { $('#lockScreen').classList.remove('show'); }

let lockoutTimer = null;
function startLockout(seconds) {
  $('#unlockBtn').disabled = true;
  clearInterval(lockoutTimer);
  let left = seconds;
  const tick = () => {
    if (left <= 0) {
      clearInterval(lockoutTimer);
      $('#unlockBtn').disabled = false;
      $('#lockError').textContent = '';
    } else {
      $('#lockError').textContent = `Too many attempts — try again in ${left}s`;
      left--;
    }
  };
  tick();
  lockoutTimer = setInterval(tick, 1000);
}

async function unlock() {
  if ($('#unlockBtn').disabled) return;
  const pin = $('#pinInput').value;
  const r = await post('/api/login', { pin });
  if (r.ok) {
    $('#lockError').textContent = ''; $('#pinInput').value = '';
    clearInterval(lockoutTimer); $('#unlockBtn').disabled = false;
    hideLock(); await seedChart(); connect();
  } else if (r.retryAfter) {
    $('#pinInput').value = '';
    startLockout(r.retryAfter);
  } else {
    $('#lockError').textContent = r.error || 'incorrect PIN';
    $('#pinInput').select();
  }
}
$('#unlockBtn').onclick = unlock;
$('#pinInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });

$('#logoutBtn').onclick = async () => {
  await post('/api/logout', {});
  if (stream) { stream.close(); stream = null; }
  showLock();
};

async function seedChart() {
  const hist = await fetch('/api/history').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  if (Array.isArray(hist) && hist.length) {
    chartData = hist.map((p) => ({ t: p.t, e: p.e, r: p.r }));
  }
}

async function init() {
  const a = await fetch('/api/auth').then((r) => r.json()).catch(() => ({ required: false, authed: true }));
  authRequired = !!a.required;
  $('#sessionCard').style.display = authRequired ? 'block' : 'none';
  if (a.required && !a.authed) { showLock(); return; }
  await seedChart();
  connect();
}
init();
