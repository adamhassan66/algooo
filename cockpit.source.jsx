const { useState, useEffect, useMemo, useRef } = React;

// Persist a piece of state to localStorage so balances/trades survive reloads.
function usePersist(key, initial) {
  const [v, setV] = useState(() => {
    try { const s = localStorage.getItem(key); return s != null ? JSON.parse(s) : initial; }
    catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }, [key, v]);
  return [v, setV];
}

/* ──────────────────────────────────────────────────────────────────────────
   KALSHI COCKPIT — an honest trading workspace
   ────────────────────────────────────────────────────────────────────────── */

const C = {
  bg: "#05070e", panel: "#0a0f1b", card: "#0d1424", border: "#16243a",
  lift: "#15233a", text: "#e9f1ff", sub: "#7891b0", dim: "#33425c",
  green: "#2dd4a7", red: "#f6536b", amber: "#f5b54a",
  blue: "#4c8dff", violet: "#9d7bff", cyan: "#37c9e0",
};

const money = (n) =>
  (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function laTime() {
  return new Date().toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  });
}

/* ── tiny UI atoms ───────────────────────────────────────────────────────── */
function Stat({ label, value, color }) {
  return (
    <div style={{ flex: 1, background: C.bg, borderRadius: 12, padding: "10px 6px", textAlign: "center", border: `1px solid ${C.border}` }}>
      <div style={{ color: C.sub, fontSize: 10, fontWeight: 600, letterSpacing: 0.4, marginBottom: 3 }}>{label}</div>
      <div style={{ color: color || C.text, fontSize: 15, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

/* ── PnL line chart (hand-drawn SVG, no deps) ────────────────────────────── */
function PnLChart({ trades }) {
  const W = 320, H = 150, pad = 6;
  const series = useMemo(() => {
    let run = 0;
    const pts = [{ pnl: 0 }];
    trades.forEach((t) => { run += t.pnl; pts.push({ pnl: run }); });
    return pts;
  }, [trades]);

  const vals = series.map((p) => p.pnl);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  const span = max - min || 1;
  const x = (i) => pad + (i / Math.max(1, series.length - 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((v - min) / span) * (H - pad * 2);
  const last = vals[vals.length - 1];
  const line = last >= 0 ? C.green : C.red;
  const path = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.pnl).toFixed(1)}`).join(" ");
  const area = `${path} L${x(series.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`;
  const zeroY = y(0);

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ color: C.sub, fontSize: 12, fontWeight: 600 }}>Cumulative P&L</span>
        <span style={{ color: line, fontSize: 22, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{money(last)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }}>
        <defs>
          <linearGradient id="pnlfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={line} stopOpacity="0.25" />
            <stop offset="100%" stopColor={line} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={pad} y1={zeroY} x2={W - pad} y2={zeroY} stroke={C.dim} strokeWidth="1" strokeDasharray="3 4" />
        {trades.length > 0 && <path d={area} fill="url(#pnlfill)" />}
        {trades.length > 0 && <path d={path} fill="none" stroke={line} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {series.map((p, i) => i > 0 && (
          <circle key={i} cx={x(i)} cy={y(p.pnl)} r="2.6" fill={C.bg} stroke={line} strokeWidth="1.6" />
        ))}
      </svg>
      {trades.length === 0 && (
        <div style={{ color: C.dim, fontSize: 12, textAlign: "center", marginTop: -84, marginBottom: 78 }}>
          Log a trade to start your curve
        </div>
      )}
    </div>
  );
}

/* ── Strategy tab ────────────────────────────────────────────────────────── */
function Strategy({ entry, setEntry }) {
  const sell = +(entry * 2.2).toFixed(1);
  const stop = +(entry * 0.3).toFixed(1);
  const win = +(sell - entry).toFixed(1);
  const loss = +(entry - stop).toFixed(1);
  const rr = (win / loss).toFixed(2);
  const breakeven = (loss / (win + loss)) * 100; // win-rate needed to net zero (pre-fee)

  return (
    <div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
          <span style={{ color: C.sub, fontSize: 13, fontWeight: 600 }}>Entry price per contract (¢)</span>
          <span style={{ color: C.blue, fontSize: 28, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{entry}¢</span>
        </div>
        <input type="range" min={2} max={90} step={1} value={entry} onChange={(e) => setEntry(+e.target.value)}
          style={{ width: "100%", accentColor: C.blue, height: 26 }} />

        <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
          <Stat label="SELL 2.2x" value={`${sell}¢`} color={C.green} />
          <Stat label="STOP 0.3x" value={`${stop}¢`} color={C.red} />
          <Stat label="WIN" value={`+${win}¢`} color={C.green} />
          <Stat label="RISK" value={`-${loss}¢`} color={C.red} />
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <Stat label="REWARD : RISK" value={`${rr} : 1`} color={C.amber} />
          <Stat label="BREAK-EVEN WIN RATE" value={`${breakeven.toFixed(0)}%`} color={C.violet} />
        </div>
      </div>

      <div style={{ background: C.amber + "0f", border: `1px solid ${C.amber}33`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ color: C.amber, fontSize: 12, fontWeight: 800, letterSpacing: 0.4, marginBottom: 6 }}>THE HONEST READ</div>
        <div style={{ color: C.text, fontSize: 13, lineHeight: 1.6 }}>
          Your {rr}:1 reward-to-risk means you only need to win <b>{breakeven.toFixed(0)}%</b> of trades to break even before fees.
          The catch: reaching +120% before −70% on a near-random 15-min BTC move happens roughly <b>{breakeven.toFixed(0)}%</b> of the
          time too — so the favorable R:R and the lower hit-rate cancel out. Net edge before fees ≈ 0; after Kalshi fees it's slightly negative.
          The discipline (fixed sell, hard stop, never holding to expiry) is what protects you, not a hidden edge.
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
        <div style={{ color: C.cyan, fontSize: 12, fontWeight: 800, letterSpacing: 0.4, marginBottom: 8 }}>YOUR PLAYBOOK</div>
        {[
          `Limit buy at ${entry}¢ — maker order, no fee if it rests and fills`,
          `Immediately set limit sell at ${sell}¢`,
          `Hard stop at ${stop}¢ — no exceptions, no averaging down`,
          `Exit before expiry every time`,
          `Risk a fixed, small fraction of bankroll per trade`,
        ].map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 10, marginBottom: 7 }}>
            <div style={{ minWidth: 22, height: 22, borderRadius: "50%", background: C.cyan + "22", color: C.cyan, fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div>
            <div style={{ color: C.text, fontSize: 13, lineHeight: 1.5, paddingTop: 1 }}>{s}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Parlay builder (true combined odds) ─────────────────────────────────── */
function Parlay() {
  const [legs, setLegs] = useState([
    { id: 1, name: "Leg 1", p: 70 },
    { id: 2, name: "Leg 2", p: 65 },
  ]);

  const combined = legs.reduce((a, l) => a * (l.p / 100), 1) * 100;
  const fairOdds = combined > 0 ? (100 / combined) : 0; // decimal odds you'd need just to break even

  const add = () => setLegs((l) => [...l, { id: Date.now(), name: `Leg ${l.length + 1}`, p: 60 }]);
  const remove = (id) => setLegs((l) => l.filter((x) => x.id !== id));
  const setP = (id, p) => setLegs((l) => l.map((x) => (x.id === id ? { ...x, p } : x)));

  const tone = combined >= 50 ? C.green : combined >= 30 ? C.amber : C.red;

  return (
    <div>
      <div style={{ background: C.card, border: `1px solid ${C.violet}33`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <span style={{ color: C.sub, fontSize: 12, fontWeight: 600 }}>True combined hit chance</span>
          <span style={{ color: tone, fontSize: 34, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{combined.toFixed(1)}%</span>
        </div>
        <div style={{ height: 8, background: C.dim, borderRadius: 4, overflow: "hidden", margin: "8px 0 10px" }}>
          <div style={{ height: "100%", width: `${Math.min(100, combined)}%`, background: tone, borderRadius: 4 }} />
        </div>
        <div style={{ color: C.sub, fontSize: 12, lineHeight: 1.5 }}>
          To break even, this {legs.length}-leg parlay needs to pay at least <b style={{ color: C.text }}>{fairOdds.toFixed(2)}x</b>.
          Anything the book offers below that is a losing bet over time. Each leg you add divides this number down.
        </div>
      </div>

      {legs.map((l, i) => (
        <div key={l.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ color: C.text, fontSize: 13, fontWeight: 700 }}>Leg {i + 1}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: l.p >= 60 ? C.green : C.amber, fontSize: 16, fontWeight: 800 }}>{l.p}%</span>
              {legs.length > 1 && (
                <button onClick={() => remove(l.id)} style={{ background: "none", border: "none", color: C.red, fontSize: 18, cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
              )}
            </div>
          </div>
          <div style={{ color: C.dim, fontSize: 11, marginBottom: 6 }}>Your honest estimate of this leg hitting</div>
          <input type="range" min={5} max={95} step={1} value={l.p} onChange={(e) => setP(l.id, +e.target.value)}
            style={{ width: "100%", accentColor: C.violet, height: 24 }} />
        </div>
      ))}

      <button onClick={add} style={{
        width: "100%", padding: 13, borderRadius: 12, border: `1px dashed ${C.violet}66`,
        background: C.violet + "12", color: C.violet, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
      }}>+ Add leg</button>
    </div>
  );
}

/* ── Trade log + PnL ─────────────────────────────────────────────────────── */
function Log({ trades, setTrades, entry }) {
  const [label, setLabel] = useState("");
  const [stake, setStake] = useState(20);

  const win = +(entry * 2.2 - entry).toFixed(1);   // ¢ per contract
  const loss = +(entry - entry * 0.3).toFixed(1);

  const record = (didWin) => {
    const perContractDelta = (didWin ? win : -loss) / 100; // dollars per contract
    const contracts = Math.max(1, Math.round(stake / (entry / 100)));
    const pnl = +(perContractDelta * contracts).toFixed(2);
    setTrades((t) => [...t, { id: Date.now(), label: label.trim() || `${didWin ? "Win" : "Loss"} @ ${entry}¢`, pnl, win: didWin }]);
    setLabel("");
  };

  const total = trades.reduce((a, t) => a + t.pnl, 0);
  const wins = trades.filter((t) => t.win).length;
  const rate = trades.length ? (wins / trades.length) * 100 : 0;

  return (
    <div>
      <PnLChart trades={trades} />

      <div style={{ display: "flex", gap: 6, margin: "14px 0" }}>
        <Stat label="TRADES" value={trades.length} />
        <Stat label="WIN RATE" value={`${rate.toFixed(0)}%`} color={rate >= 37 ? C.green : C.amber} />
        <Stat label="NET" value={money(total)} color={total >= 0 ? C.green : C.red} />
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ color: C.sub, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Log a trade</div>
        <input
          value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Market (optional) e.g. BTC 2:15pm UP"
          style={{ width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "11px 12px", color: C.text, fontSize: 14, fontFamily: "inherit", marginBottom: 12 }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <span style={{ color: C.sub, fontSize: 12 }}>Stake</span>
          <span style={{ color: C.blue, fontSize: 18, fontWeight: 800 }}>${stake}</span>
        </div>
        <input type="range" min={2} max={200} step={1} value={stake} onChange={(e) => setStake(+e.target.value)}
          style={{ width: "100%", accentColor: C.blue, height: 24, marginBottom: 12 }} />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => record(true)} style={{ flex: 1, padding: 13, borderRadius: 12, border: "none", background: C.green, color: "#04140f", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>Win +{money((win / 100) * Math.max(1, Math.round(stake / (entry / 100))))}</button>
          <button onClick={() => record(false)} style={{ flex: 1, padding: 13, borderRadius: 12, border: "none", background: C.red, color: "#1a060a", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>Loss −{money((loss / 100) * Math.max(1, Math.round(stake / (entry / 100))))}</button>
        </div>
      </div>

      {trades.slice().reverse().map((t) => (
        <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "11px 13px", marginBottom: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.win ? C.green : C.red, flexShrink: 0 }} />
          <div style={{ flex: 1, color: C.text, fontSize: 13, fontWeight: 600 }}>{t.label}</div>
          <div style={{ color: t.pnl >= 0 ? C.green : C.red, fontSize: 14, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{t.pnl >= 0 ? "+" : ""}{money(t.pnl)}</div>
          <button onClick={() => setTrades((x) => x.filter((y) => y.id !== t.id))} style={{ background: "none", border: "none", color: C.dim, fontSize: 17, cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
        </div>
      ))}
    </div>
  );
}

/* ── Live Kalshi 15-min BTC scan (best effort; may be CORS-blocked) ───────── */
// Returns the nearest-to-close open BTC market, or a status. Never throws to
// the UI — failures become {status:"blocked"|"nomarket"} so the bot/clock
// keep working off Coinbase + the wall clock.
async function fetchKalshiBtc(proxy, token) {
  // Preferred path: your own read-only Cloudflare Worker (no CORS, no keys
  // in the app). See kalshi-proxy/ for the deployable Worker.
  if (proxy) {
    try {
      const r = await fetch(proxy.replace(/\/$/, "") + "/btc", { headers: token ? { Authorization: "Bearer " + token } : {} });
      if (!r.ok) return { status: "proxyerr", msg: "proxy " + r.status };
      return await r.json(); // { status:"ok", market } | { status:"nomarket" }
    } catch (e) { return { status: "proxyerr", msg: String((e && e.message) || e) }; }
  }
  // Fallback: direct browser fetch (usually CORS-blocked on a phone).
  const base = "https://api.elections.kalshi.com/trade-api/v2";
  const candidates = ["KXBTCD", "KXBTC", "KXBTCRANGE", "KXBTC15", "KXBTCMINI"];
  let best = null, scanned = 0, reached = false;
  for (const s of candidates) {
    let r;
    try { r = await fetch(`${base}/markets?series_ticker=${s}&status=open&limit=200`, { headers: { Accept: "application/json" } }); }
    catch (e) { return { status: "blocked", msg: String(e && e.message || e) }; } // network/CORS
    reached = true;
    if (!r.ok) continue;
    let ms = [];
    try { ms = (await r.json()).markets || []; } catch { continue; }
    for (const m of ms) {
      scanned++;
      const close = Date.parse(m.close_time || m.expiration_time || "");
      if (!close || close < Date.now()) continue;
      if (!best || close < best.close) best = { m, close };
    }
  }
  if (!reached) return { status: "blocked", msg: "no response" };
  if (!best) return { status: "nomarket", scanned };
  const m = best.m;
  return {
    status: "ok",
    market: {
      title: m.title || m.ticker, ticker: m.ticker, closeTime: best.close,
      upAsk: +m.yes_ask || 50, downAsk: +m.no_ask || 50,
      strike: m.cap_strike ?? m.floor_strike ?? null,
    },
  };
}

/* ── Paper trading: Kalshi 15-min BTC up/down, with auto-pilot ────────────── */
const Q = 15 * 60 * 1000; // 15-minute window
const winEnd = (ts) => Math.floor(ts / Q) * Q + Q; // next :00/:15/:30/:45 boundary

// Kalshi trading fee, charged when you buy: ceil(0.07 * C * P * (1-P)) dollars,
// P in dollars. This is what makes a paper "win" match real net money.
const kalshiFee = (contracts, entryCents) => {
  const p = entryCents / 100;
  return Math.ceil(0.07 * contracts * p * (1 - p) * 100) / 100;
};

function PaperTrade({ btc }) {
  const [bal, setBal] = usePersist("kc_bal", 1000);
  const [open, setOpen] = usePersist("kc_open", []);
  const [hist, setHist] = usePersist("kc_hist", []);
  const [auto, setAuto] = usePersist("kc_auto", false);
  const [botStake, setBotStake] = usePersist("kc_botstake", 10);
  const [side, setSide] = useState("UP");
  const [entry, setEntry] = useState(50);
  const [stake, setStake] = useState(20);
  const [now, setNow] = useState(Date.now());
  const [kalshi, setKalshi] = useState({ status: "idle" });
  const [botLog, setBotLog] = useState([]);
  const [proxy, setProxy] = usePersist("kc_proxy", "");
  const [token, setToken] = usePersist("kc_token", "");
  const [realBal, setRealBal] = useState(null);
  const [showConnect, setShowConnect] = useState(false);
  const btcRef = useRef(btc);
  btcRef.current = btc;
  const priceHist = useRef([]);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // keep ~20 min of price samples for the momentum signal
  useEffect(() => {
    if (!btc) return;
    const a = priceHist.current;
    a.push({ t: Date.now(), p: btc });
    while (a.length > 130) a.shift();
  }, [btc]);

  // poll the real Kalshi market via your proxy (best effort)
  useEffect(() => {
    let live = true;
    const run = () => fetchKalshiBtc(proxy, token).then((r) => { if (live) setKalshi(r); }).catch((e) => { if (live) setKalshi({ status: "blocked", msg: String(e.message || e) }); });
    run();
    const t = setInterval(run, 30000);
    return () => { live = false; clearInterval(t); };
  }, [proxy, token]);

  // read-only real balance, only if the proxy + key are configured
  useEffect(() => {
    if (!proxy) { setRealBal(null); return; }
    let live = true;
    const run = () => fetch(proxy.replace(/\/$/, "") + "/balance", { headers: token ? { Authorization: "Bearer " + token } : {} })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d && typeof d.balance === "number") setRealBal(d.balance); })
      .catch(() => {});
    run();
    const t = setInterval(run, 30000);
    return () => { live = false; clearInterval(t); };
  }, [proxy, token]);

  // BTC change over the last ~2 minutes (the bot's signal)
  const momentum = () => {
    const a = priceHist.current;
    if (!btc || a.length < 2) return 0;
    const cutoff = Date.now() - 120000;
    let ref = a[0];
    for (const s of a) { if (s.t <= cutoff) ref = s; else break; }
    return btc - ref.p;
  };

  // place a paper trade; returns false if unaffordable
  const placeTrade = (sd, entryCents, stakeUSD, settleAt, byBot) => {
    if (!btc) return false;
    const contracts = Math.max(1, Math.floor(stakeUSD / (entryCents / 100)));
    const cost = +((contracts * entryCents) / 100).toFixed(2);
    const fee = kalshiFee(contracts, entryCents);
    if (cost + fee > bal) return false;
    const t0 = Date.now();
    setBal((b) => +(b - cost - fee).toFixed(2));
    setOpen((o) => [{ id: t0 + Math.random(), side: sd, entry: entryCents, contracts, cost, fee, p0: btc, placedAt: t0, settleAt, byBot: !!byBot }, ...o]);
    return true;
  };

  // settle anything whose window has elapsed, using the latest price
  useEffect(() => {
    const price = btcRef.current;
    if (!price) return;
    setOpen((prev) => {
      const due = prev.filter((t) => now >= t.settleAt);
      if (!due.length) return prev;
      let credit = 0;
      const settled = due.map((t) => {
        const tie = price === t.p0;
        const win = t.side === "UP" ? price > t.p0 : price < t.p0;
        const payout = tie ? t.cost : win ? t.contracts : 0;
        credit += payout;
        return { ...t, settlePrice: price, result: tie ? "push" : win ? "win" : "loss", pnl: +(payout - t.cost - (t.fee || 0)).toFixed(2) };
      });
      if (credit) setBal((b) => +(b + credit).toFixed(2));
      setHist((h) => [...settled, ...h].slice(0, 60));
      return prev.filter((t) => now < t.settleAt);
    });
  }, [now]);

  // the bot: once per window, near the open, pick a side and paper-trade it.
  // Window end = the real Kalshi close time when we have it, else the clock.
  const settleAt = (kalshi.market && kalshi.market.closeTime > now + 60000) ? kalshi.market.closeTime : winEnd(now);
  useEffect(() => {
    if (!auto || !btc) return;
    const we = settleAt;
    if (we - now <= 60000) return;                 // too late in this window
    if (open.some((t) => t.byBot && t.settleAt === we)) return; // already traded this window
    const mom = momentum();
    const sd = mom >= 0 ? "UP" : "DOWN";
    const e = kalshi.market ? (sd === "UP" ? kalshi.market.upAsk : kalshi.market.downAsk) : entry;
    if (placeTrade(sd, e, botStake, we, true)) {
      const stamp = new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      setBotLog((l) => [`${stamp} · ${sd} @ ${e}¢ — BTC ${mom >= 0 ? "+" : ""}${mom.toFixed(0)}/2m`, ...l].slice(0, 8));
    }
  }, [now, auto]);

  const contracts = Math.max(1, Math.floor(stake / (entry / 100)));
  const cost = +((contracts * entry) / 100).toFixed(2);
  const fee = kalshiFee(contracts, entry);
  const profitIfWin = +(((contracts * (100 - entry)) / 100) - fee).toFixed(2); // net of fee
  const canPlace = !!btc && cost + fee <= bal;
  const manualSettle = (kalshi.market && kalshi.market.closeTime > now + 60000) ? kalshi.market.closeTime : winEnd(now);

  const reset = () => { setBal(1000); setOpen([]); setHist([]); setBotLog([]); };

  const atRisk = open.reduce((a, t) => a + t.cost, 0);
  const realized = hist.reduce((a, t) => a + t.pnl, 0);
  const wins = hist.filter((t) => t.result === "win").length;
  const rate = hist.length ? (wins / hist.length) * 100 : 0;
  const cd = (msLeft) => { const s = Math.max(0, Math.ceil(msLeft / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  const SideBtn = ({ id, label, arrow, col }) => (
    <button onClick={() => setSide(id)} style={{
      flex: 1, padding: "14px 0", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
      fontSize: 16, fontWeight: 900, letterSpacing: 0.3,
      border: `1.5px solid ${side === id ? col : C.border}`,
      background: side === id ? col + "22" : C.bg, color: side === id ? col : C.sub,
    }}>{arrow} {label}</button>
  );

  const kStatus = {
    idle: proxy ? "Connecting to your Kalshi proxy…" : "Not connected. Add your read-only proxy below to see live odds.",
    ok: null,
    nomarket: "Reached Kalshi, but found no open BTC market right now.",
    proxyerr: `Proxy error (${kalshi.msg || "?"}). Check the URL/token below.`,
    blocked: "Kalshi blocked the direct request (CORS). Add your read-only proxy below — the bot still runs on the Coinbase price + 15-min clock meanwhile.",
  }[kalshi.status];

  const inputStyle = { width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 10px", color: C.text, fontSize: 13, fontFamily: "inherit", marginBottom: 8 };

  return (
    <div>
      {/* balance + next window */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ color: C.sub, fontSize: 12, fontWeight: 600 }}>Mock balance</span>
          <span style={{ color: C.text, fontSize: 30, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{money(bal)}</span>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          <Stat label="NEXT WINDOW" value={cd(settleAt - now)} color={C.cyan} />
          <Stat label="AT RISK" value={money(atRisk)} color={C.amber} />
          <Stat label="REALIZED" value={money(realized)} color={realized >= 0 ? C.green : C.red} />
          <Stat label="WIN RATE" value={`${rate.toFixed(0)}%`} color={rate >= 50 ? C.green : C.sub} />
        </div>
      </div>

      {/* live Kalshi market */}
      <div style={{ background: C.card, border: `1px solid ${kalshi.status === "ok" ? C.cyan + "55" : C.border}`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ color: C.cyan, fontSize: 11, fontWeight: 800, letterSpacing: 0.5 }}>LIVE KALSHI MARKET {proxy ? "· via proxy" : ""}</span>
          <button onClick={() => setShowConnect((v) => !v)} style={{ background: "none", border: `1px solid ${proxy ? C.green + "66" : C.border}`, color: proxy ? C.green : C.sub, fontSize: 11, fontWeight: 700, borderRadius: 8, padding: "4px 9px", cursor: "pointer", fontFamily: "inherit" }}>
            {proxy ? "✓ Connected" : "Connect"}
          </button>
        </div>

        {kalshi.status === "ok" ? (
          <div>
            <div style={{ color: C.text, fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{kalshi.market.title}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <Stat label="UP (YES)" value={`${kalshi.market.upAsk}¢`} color={C.green} />
              <Stat label="DOWN (NO)" value={`${kalshi.market.downAsk}¢`} color={C.red} />
              <Stat label="CLOSES IN" value={cd(kalshi.market.closeTime - now)} color={C.cyan} />
            </div>
          </div>
        ) : (
          <div style={{ color: kalshi.status === "blocked" || kalshi.status === "proxyerr" ? C.amber : C.sub, fontSize: 12, lineHeight: 1.5 }}>{kStatus}</div>
        )}

        {realBal != null && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ color: C.sub, fontSize: 12 }}>Real Kalshi balance · read-only</span>
            <span style={{ color: C.green, fontSize: 16, fontWeight: 800 }}>{money(realBal / 100)}</span>
          </div>
        )}

        {showConnect && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
            <div style={{ color: C.dim, fontSize: 11, lineHeight: 1.5, marginBottom: 8 }}>
              Read-only. Deploy <code style={{ color: C.cyan }}>kalshi-proxy/</code> (a Cloudflare Worker) and paste its URL. It can never place orders.
            </div>
            <input value={proxy} onChange={(e) => setProxy(e.target.value.trim())} placeholder="https://kalshi-proxy.you.workers.dev" style={inputStyle} />
            <input value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder="Access token (optional)" style={inputStyle} />
            {proxy && (
              <button onClick={() => { setProxy(""); setToken(""); setRealBal(null); }} style={{ background: "none", border: `1px solid ${C.border}`, color: C.red, fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontFamily: "inherit" }}>Disconnect</button>
            )}
          </div>
        )}
      </div>

      {/* auto-pilot */}
      <div style={{ background: auto ? C.violet + "12" : C.card, border: `1px solid ${auto ? C.violet + "55" : C.border}`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ color: auto ? C.violet : C.text, fontSize: 14, fontWeight: 800 }}>🤖 Auto-pilot</div>
            <div style={{ color: C.dim, fontSize: 11, marginTop: 2 }}>Bot picks a side each window from 2-min BTC momentum</div>
          </div>
          <button onClick={() => setAuto((v) => !v)} style={{
            width: 54, height: 30, borderRadius: 999, border: "none", cursor: "pointer",
            background: auto ? C.violet : C.lift, position: "relative", transition: "background .15s",
          }}>
            <span style={{ position: "absolute", top: 3, left: auto ? 27 : 3, width: 24, height: 24, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
          </button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 12 }}>
          <span style={{ color: C.sub, fontSize: 12 }}>Bot stake / window</span>
          <span style={{ color: C.violet, fontSize: 16, fontWeight: 800 }}>${botStake}</span>
        </div>
        <input type="range" min={1} max={Math.max(2, Math.min(100, Math.floor(bal)))} step={1} value={botStake} onChange={(e) => setBotStake(+e.target.value)}
          style={{ width: "100%", accentColor: C.violet, height: 24 }} />
        {botLog.length > 0 && (
          <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
            {botLog.map((l, i) => (
              <div key={i} style={{ color: i === 0 ? C.text : C.dim, fontSize: 11, fontVariantNumeric: "tabular-nums", marginBottom: 2 }}>{l}</div>
            ))}
          </div>
        )}
      </div>

      {/* manual ticket */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
          <span style={{ color: C.sub, fontSize: 13, fontWeight: 600 }}>Manual ticket</span>
          <span style={{ color: C.amber, fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{btc ? `$${Math.round(btc).toLocaleString()}` : "price…"}</span>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <SideBtn id="UP" label="UP" arrow="▲" col={C.green} />
          <SideBtn id="DOWN" label="DOWN" arrow="▼" col={C.red} />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ color: C.sub, fontSize: 12 }}>Entry price / contract</span>
          <span style={{ color: C.blue, fontSize: 18, fontWeight: 800 }}>{entry}¢</span>
        </div>
        <input type="range" min={1} max={99} step={1} value={entry} onChange={(e) => setEntry(+e.target.value)}
          style={{ width: "100%", accentColor: C.blue, height: 24, marginBottom: 8 }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ color: C.sub, fontSize: 12 }}>Stake</span>
          <span style={{ color: C.blue, fontSize: 18, fontWeight: 800 }}>${stake}</span>
        </div>
        <input type="range" min={1} max={Math.max(2, Math.min(200, Math.floor(bal)))} step={1} value={stake} onChange={(e) => setStake(+e.target.value)}
          style={{ width: "100%", accentColor: C.blue, height: 24, marginBottom: 12 }} />

        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <Stat label="CONTRACTS" value={contracts} />
          <Stat label="COST + FEE" value={money(cost + fee)} color={C.amber} />
          <Stat label="NET WIN" value={`+${money(profitIfWin)}`} color={C.green} />
        </div>
        <div style={{ color: C.dim, fontSize: 11, marginBottom: 12 }}>
          Incl. Kalshi fee {money(fee)} · win pays ${contracts}.00 · settles vs BTC at window close
        </div>

        <button onClick={() => placeTrade(side, entry, stake, manualSettle, false)} disabled={!canPlace} style={{
          width: "100%", padding: 15, borderRadius: 12, border: "none",
          background: canPlace ? (side === "UP" ? C.green : C.red) : C.lift,
          color: canPlace ? "#06140f" : C.dim, fontSize: 15, fontWeight: 900, fontFamily: "inherit",
          cursor: canPlace ? "pointer" : "default",
        }}>
          {btc ? `Place ${side} · settles ${cd(manualSettle - now)}` : "Waiting for BTC price…"}
        </button>
        {!canPlace && btc && <div style={{ color: C.red, fontSize: 12, marginTop: 8, textAlign: "center" }}>Stake exceeds your mock balance</div>}
      </div>

      {/* open positions */}
      {open.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: C.sub, fontSize: 12, fontWeight: 700, letterSpacing: 0.4, marginBottom: 8 }}>OPEN · {open.length}</div>
          {open.map((t) => {
            const delta = btc ? btc - t.p0 : 0;
            const state = !btc ? null : delta === 0 ? "even" : (t.side === "UP" ? delta > 0 : delta < 0) ? "win" : "lose";
            const stateLabel = state === "win" ? "WINNING" : state === "lose" ? "LOSING" : state === "even" ? "EVEN" : "";
            const stateCol = state === "win" ? C.green : state === "lose" ? C.red : C.sub;
            const left = t.settleAt - now;
            const col = t.side === "UP" ? C.green : C.red;
            return (
              <div key={t.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: col, fontSize: 14, fontWeight: 900 }}>{t.side === "UP" ? "▲" : "▼"} {t.side}{t.byBot ? <span style={{ color: C.violet, fontSize: 11, fontWeight: 800 }}> 🤖</span> : null}</span>
                  <span style={{ color: C.text, fontVariantNumeric: "tabular-nums", fontSize: 14, fontWeight: 800 }}>{cd(left)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: C.sub }}>
                  <span>entry ${Math.round(t.p0).toLocaleString()} · now {btc ? `$${Math.round(btc).toLocaleString()}` : "—"}</span>
                  <span style={{ color: stateCol, fontWeight: 800 }}>{stateLabel} {btc ? `(${delta >= 0 ? "+" : ""}${delta.toFixed(0)})` : ""}</span>
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: C.dim }}>{t.contracts} @ {t.entry}¢ · cost {money(t.cost)} +fee {money(t.fee || 0)} · win → +{money(+(((t.contracts * (100 - t.entry)) / 100) - (t.fee || 0)).toFixed(2))} net</div>
              </div>
            );
          })}
        </div>
      )}

      {/* history */}
      <PnLChart trades={hist.slice().reverse()} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "14px 0 8px" }}>
        <span style={{ color: C.sub, fontSize: 12, fontWeight: 700, letterSpacing: 0.4 }}>SETTLED · {hist.length}</span>
        <button onClick={reset} style={{ background: "none", border: `1px solid ${C.border}`, color: C.sub, fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontFamily: "inherit" }}>Reset to $1,000</button>
      </div>
      {hist.map((t) => (
        <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 13px", marginBottom: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.result === "win" ? C.green : t.result === "push" ? C.amber : C.red, flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: 13 }}>
            <div style={{ color: C.text, fontWeight: 700 }}>{t.side === "UP" ? "▲" : "▼"} {t.side} · {t.result.toUpperCase()}{t.byBot ? " 🤖" : ""}</div>
            <div style={{ color: C.dim, fontSize: 11 }}>${Math.round(t.p0).toLocaleString()} → ${Math.round(t.settlePrice).toLocaleString()} · {t.contracts}@{t.entry}¢</div>
          </div>
          <div style={{ color: t.pnl >= 0 ? C.green : C.red, fontSize: 14, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{t.pnl >= 0 ? "+" : ""}{money(t.pnl)}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Root ────────────────────────────────────────────────────────────────── */
function Cockpit() {
  const [tab, setTab] = useState("paper");
  const [entry, setEntry] = useState(20);
  const [trades, setTrades] = useState([]);
  const [btc, setBtc] = useState(null);
  const [clock, setClock] = useState(laTime());

  useEffect(() => {
    const t = setInterval(() => setClock(laTime()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const go = async () => {
      try {
        const r = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot");
        const d = await r.json();
        const p = parseFloat(d?.data?.amount);
        if (!isNaN(p)) setBtc(p);
      } catch { /* offline — price just shows — */ }
    };
    go();
    const t = setInterval(go, 10000);
    return () => clearInterval(t);
  }, []);

  const tabs = [["paper", "Trade"], ["strategy", "Strategy"], ["parlay", "Parlay"], ["log", "P&L Log"]];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "-apple-system,'SF Pro Text','Helvetica Neue',sans-serif", WebkitFontSmoothing: "antialiased", paddingBottom: 60 }}>
      {/* header */}
      <div style={{ background: C.panel, borderBottom: `1px solid ${C.border}`, padding: "16px 16px 0", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div style={{ color: C.text, fontSize: 19, fontWeight: 900, letterSpacing: -0.3 }}>Kalshi Cockpit</div>
            <div style={{ color: C.sub, fontSize: 12, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{clock} · Los Angeles</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: C.amber, fontSize: 20, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{btc ? `$${Math.round(btc).toLocaleString()}` : "—"}</div>
            <div style={{ color: C.sub, fontSize: 11 }}>BTC spot · live</div>
          </div>
        </div>
        <div style={{ display: "flex" }}>
          {tabs.map(([id, lbl]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              flex: 1, padding: "11px 4px", background: "none", border: "none",
              borderBottom: tab === id ? `2px solid ${C.blue}` : "2px solid transparent",
              color: tab === id ? C.text : C.sub, fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer",
            }}>{lbl}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}>
        {tab === "paper" && <PaperTrade btc={btc} />}
        {tab === "strategy" && <Strategy entry={entry} setEntry={setEntry} />}
        {tab === "parlay" && <Parlay />}
        {tab === "log" && <Log trades={trades} setTrades={setTrades} entry={entry} />}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Cockpit />);
