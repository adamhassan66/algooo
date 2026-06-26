const { useState, useEffect, useMemo } = React;

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

/* ── Root ────────────────────────────────────────────────────────────────── */
function Cockpit() {
  const [tab, setTab] = useState("strategy");
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

  const tabs = [["strategy", "Strategy"], ["parlay", "Parlay"], ["log", "P&L Log"]];

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
        {tab === "strategy" && <Strategy entry={entry} setEntry={setEntry} />}
        {tab === "parlay" && <Parlay />}
        {tab === "log" && <Log trades={trades} setTrades={setTrades} entry={entry} />}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Cockpit />);
