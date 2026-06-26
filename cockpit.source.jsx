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

// live BTC price with cents, like an exchange ticker
const fmtBtc = (n) =>
  n == null ? "—" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// normal CDF (erf approx) — used to mark an open position to a fair value so
// the bot can take profit before the window closes.
const erf = (x) => {
  const s = x < 0 ? -1 : 1, t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
};
const ncdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

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

/* ── Parlay reality-checker (baseball "1+ hits" props) ───────────────────── */
// Typical P(1+ hits in a game) by hitter tier — even stars sit ~70-75%.
const TIERS = [["Star", 74], ["Regular", 68], ["Platoon", 60]];

// The user's actual Kalshi 25-leg combo, using Kalshi's OWN posted %s where
// shown on the ticket; the rest (*) are close estimates in the same range.
const KALSHI_TICKET = [
  { name: "Trea Turner · 1+ hits", p: 73 },
  { name: "Yordan Álvarez · 1+ hits", p: 70 },
  { name: "Vladimir Guerrero Jr. · 1+ hits*", p: 70 },
  { name: "Steven Kwan · 1+ hits*", p: 70 },
  { name: "Shohei Ohtani · 1+ hits", p: 69 },
  { name: "James Wood · 1+ hits", p: 69 },
  { name: "Freddie Freeman · 1+ hits", p: 68 },
  { name: "Gunnar Henderson · 1+ hits", p: 68 },
  { name: "Ketel Marte · 1+ hits*", p: 68 },
  { name: "Fernando Tatis Jr. · 1+ hits", p: 67 },
  { name: "José Altuve · 1+ hits", p: 67 },
  { name: "Pete Alonso · 1+ hits", p: 67 },
  { name: "Cody Bellinger · 1+ hits", p: 67 },
  { name: "Corbin Carroll · 1+ hits*", p: 67 },
  { name: "Brandon Nimmo · 1+ hits*", p: 66 },
  { name: "Christian Yelich · 1+ hits*", p: 66 },
  { name: "Kyle Schwarber · 1+ hits", p: 64 },
  { name: "Pete Crow-Armstrong · 1+ hits*", p: 64 },
  { name: "Elly De La Cruz · 1+ hits", p: 63 },
  { name: "Juan Soto · 1+ hits", p: 62 },
  { name: "Byron Buxton · 1+ hits*", p: 62 },
  { name: "Nick Kurtz · 1+ hits*", p: 62 },
  { name: "Francisco Lindor · 1+ hits", p: 61 },
  { name: "Manny Machado · 1+ hits", p: 59 },
  { name: "Cal Raleigh · 1+ hits*", p: 58 },
];

function Parlay() {
  const [legs, setLegs] = usePersist("kc_parlay", [
    { id: 1, name: "Star hitter · 1+ hits", p: 74 },
    { id: 2, name: "Star hitter · 1+ hits", p: 74 },
    { id: 3, name: "Regular · 1+ hits", p: 68 },
  ]);
  const [target, setTarget] = usePersist("kc_parlay_tgt", 80); // confidence bar %
  const [payout, setPayout] = usePersist("kc_parlay_pay", 0);  // book's total-return multiple

  const probs = legs.map((l) => l.p / 100);
  const combined = probs.reduce((a, p) => a * p, 1) * 100;
  const fairOdds = combined > 0 ? 100 / combined : 0;
  const avgP = legs.length ? probs.reduce((a, p) => a + p, 0) / legs.length : 0.7;
  const maxLegs = avgP > 0 && avgP < 1 ? Math.max(0, Math.floor(Math.log(target / 100) / Math.log(avgP))) : 0;
  const ev = payout > 0 ? (combined / 100) * payout - 1 : null; // per $1 staked

  const add = () => setLegs((l) => [...l, { id: Date.now(), name: "Regular · 1+ hits", p: 68 }]);
  const remove = (id) => setLegs((l) => l.filter((x) => x.id !== id));
  const setP = (id, p) => setLegs((l) => l.map((x) => (x.id === id ? { ...x, p } : x)));
  const setName = (id, name) => setLegs((l) => l.map((x) => (x.id === id ? { ...x, name } : x)));
  const loadTicket = () => setLegs(KALSHI_TICKET.map((x, i) => ({ id: i + 1, ...x })));
  // keep the k highest-probability legs
  const trimTo = (k) => setLegs((l) => [...l].sort((a, b) => b.p - a.p).slice(0, k).map((x, i) => ({ ...x, id: i + 1 })));

  // trade-off ladder: combined % if you keep only the top-k legs by probability
  const sortedP = [...probs].sort((a, b) => b - a);
  const topKPct = (k) => sortedP.slice(0, k).reduce((a, p) => a * p, 1) * 100;
  const ladderKs = [1, 2, 3, 5, 10, 15, 25].filter((k) => k <= legs.length);

  const tone = combined >= target ? C.green : combined >= target * 0.6 ? C.amber : C.red;
  const inputStyle = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 9px", color: C.text, fontSize: 13, fontFamily: "inherit" };
  // adaptive precision so tiny combined odds don't collapse to "0.0%"
  const fmtPct = (p) => p <= 0 ? "0%" : p >= 10 ? p.toFixed(0) + "%" : p >= 1 ? p.toFixed(1) + "%" : +p.toPrecision(2) + "%";

  return (
    <div>
      <div style={{ background: C.card, border: `1px solid ${C.violet}33`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <span style={{ color: C.sub, fontSize: 12, fontWeight: 600 }}>True combined hit chance · {legs.length} legs</span>
          <span style={{ color: tone, fontSize: 34, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{fmtPct(combined)}</span>
        </div>
        <div style={{ height: 8, background: C.dim, borderRadius: 4, overflow: "hidden", margin: "8px 0 4px", position: "relative" }}>
          <div style={{ height: "100%", width: `${Math.min(100, combined)}%`, background: tone, borderRadius: 4 }} />
          <div style={{ position: "absolute", top: -2, left: `${target}%`, width: 2, height: 12, background: C.text }} title="your target" />
        </div>
        <div style={{ color: C.dim, fontSize: 11, marginBottom: 10 }}>white mark = your {target}% bar</div>
        <div style={{ color: C.sub, fontSize: 12, lineHeight: 1.5 }}>
          Break-even payout: needs to pay at least <b style={{ color: C.text }}>{fairOdds.toFixed(2)}×</b> your stake.
          Each leg you add multiplies this chance <i>down</i> — a parlay is the opposite of a sure thing.
        </div>
        <button onClick={loadTicket} style={{ width: "100%", marginTop: 12, padding: 11, borderRadius: 10, border: `1px solid ${C.cyan}55`, background: C.cyan + "12", color: C.cyan, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
          ↻ Load my Kalshi 25-leg ticket
        </button>
      </div>

      {/* trade-off ladder: cut legs, watch the chance climb */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ color: C.sub, fontSize: 11, fontWeight: 800, letterSpacing: 0.5, marginBottom: 4 }}>📉 TRIM LADDER · keep your best legs</div>
        <div style={{ color: C.dim, fontSize: 11, marginBottom: 10 }}>Combined chance if you keep only the highest-% legs. Tap to trim.</div>
        {ladderKs.map((k) => {
          const pct = topKPct(k);
          const col = pct >= 50 ? C.green : pct >= 20 ? C.amber : C.red;
          return (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ width: 58, color: C.sub, fontSize: 12, fontWeight: 700 }}>{k} leg{k > 1 ? "s" : ""}</span>
              <div style={{ flex: 1, height: 8, background: C.bg, borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: col, borderRadius: 4 }} />
              </div>
              <span style={{ width: 52, textAlign: "right", color: col, fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtPct(pct)}</span>
              <button onClick={() => trimTo(k)} style={{ background: C.lift, border: `1px solid ${C.border}`, color: C.text, fontSize: 11, fontWeight: 700, borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontFamily: "inherit" }}>Keep</button>
            </div>
          );
        })}
        <div style={{ color: C.dim, fontSize: 11, lineHeight: 1.5, marginTop: 8 }}>
          Your 25-leg ticket: ≈0.1% (Kalshi's $0.97→$909 ≈ 1 in 940). Two best legs: ~50%. That gap is the whole game.
        </div>
      </div>

      {/* reality helper */}
      <div style={{ background: combined >= target ? C.green + "12" : C.amber + "10", border: `1px solid ${combined >= target ? C.green : C.amber}44`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ color: C.sub, fontSize: 12 }}>Confidence bar</span>
          <span style={{ color: C.text, fontSize: 16, fontWeight: 800 }}>{target}%</span>
        </div>
        <input type="range" min={50} max={99} step={1} value={target} onChange={(e) => setTarget(+e.target.value)}
          style={{ width: "100%", accentColor: C.violet, height: 24, marginBottom: 6 }} />
        <div style={{ color: C.text, fontSize: 13, lineHeight: 1.55 }}>
          {combined >= target
            ? `This combo clears your ${target}% bar.`
            : `This combo is ${fmtPct(combined)} — below your ${target}% bar.`}{" "}
          At your average leg (~{(avgP * 100).toFixed(0)}%), the most legs you can stack and still stay ≥{target}% is{" "}
          <b style={{ color: maxLegs >= legs.length ? C.green : C.red }}>{maxLegs}</b>.
          {maxLegs === 0 && ` Even one ${(avgP * 100).toFixed(0)}% leg falls short of ${target}% — the closest thing to a lock is a single best leg.`}
        </div>
      </div>

      {/* optional EV check */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: C.sub, fontSize: 12 }}>Book pays (× your stake)</span>
          <input type="number" value={payout || ""} onChange={(e) => setPayout(+e.target.value || 0)} placeholder="e.g. 6" style={{ ...inputStyle, width: 70, textAlign: "right" }} />
        </div>
        {ev != null && (
          <div style={{ marginTop: 8, fontSize: 13, color: ev >= 0 ? C.green : C.red, fontWeight: 700 }}>
            EV ≈ {ev >= 0 ? "+" : ""}{(ev * 100).toFixed(0)}% per $1. {ev >= 0 ? "Rare — only if your hit-rates are honest." : `Negative — it pays ${payout}× but needs ${fairOdds.toFixed(2)}× to be fair.`}
          </div>
        )}
      </div>

      {legs.map((l, i) => (
        <div key={l.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
            <input value={l.name} onChange={(e) => setName(l.id, e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
            <span style={{ color: l.p >= 70 ? C.green : l.p >= 60 ? C.amber : C.red, fontSize: 16, fontWeight: 800 }}>{l.p}%</span>
            {legs.length > 1 && (
              <button onClick={() => remove(l.id)} style={{ background: "none", border: "none", color: C.red, fontSize: 18, cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {TIERS.map(([lbl, val]) => (
              <button key={lbl} onClick={() => setP(l.id, val)} style={{
                flex: 1, background: l.p === val ? C.violet + "22" : C.bg, border: `1px solid ${l.p === val ? C.violet : C.border}`,
                color: l.p === val ? C.violet : C.sub, fontSize: 11, fontWeight: 700, borderRadius: 8, padding: "6px 4px", cursor: "pointer", fontFamily: "inherit",
              }}>{lbl} {val}%</button>
            ))}
          </div>
          <input type="range" min={5} max={95} step={1} value={l.p} onChange={(e) => setP(l.id, +e.target.value)}
            style={{ width: "100%", accentColor: C.violet, height: 24 }} />
        </div>
      ))}

      <button onClick={add} style={{
        width: "100%", padding: 13, borderRadius: 12, border: `1px dashed ${C.violet}66`,
        background: C.violet + "12", color: C.violet, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
      }}>+ Add leg</button>

      <div style={{ color: C.dim, fontSize: 11, lineHeight: 1.5, marginTop: 12 }}>
        Reality check: a 14-leg "1+ hits" combo at ~72%/leg is ≈1% to hit — about 1 in 80. In the screenshot you sent, 4 legs had already missed. Hit props feel safe; stacking them is what makes the parlay unlikely.
      </div>
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

/* ── Scoreboard: does the strategy actually make money? ──────────────────── */
function Scoreboard({ hist }) {
  const [scope, setScope] = useState("all"); // all | bot
  const arr = useMemo(() => (scope === "bot" ? hist.filter((t) => t.byBot) : hist), [hist, scope]);
  const n = arr.length;
  const net = +arr.reduce((a, t) => a + t.pnl, 0).toFixed(2);
  const wins = arr.filter((t) => t.pnl > 0).length;
  const rate = n ? (wins / n) * 100 : 0;
  const fees = +arr.reduce((a, t) => a + (t.fee || 0), 0).toFixed(2);
  const ev = n ? net / n : 0;
  // standard error of the mean P&L — how much the EV estimate could be luck
  const variance = n > 1 ? arr.reduce((a, t) => a + (t.pnl - ev) ** 2, 0) / (n - 1) : 0;
  const stderr = n ? Math.sqrt(variance / n) : 0;
  const lo = ev - 2 * stderr, hi = ev + 2 * stderr;

  let v;
  if (n < 15) v = { label: "Gathering data…", color: C.amber, note: `Let it run — need ~${Math.max(0, 15 - n)} more settled trades before any verdict.` };
  else if (lo > 0) v = { label: "Edge looks positive ✓", color: C.green, note: "Promising — but keep running; small samples flatter winners." };
  else if (hi < 0) v = { label: "Losing strategy ✕", color: C.red, note: "Net-negative beyond noise. This is your sign NOT to risk real money on it." };
  else v = { label: "No real edge · ≈ break-even", color: C.sub, note: "Within noise of zero — exactly what 15-min BTC + fees predicts." };

  const ScopeBtn = ({ id, label }) => (
    <button onClick={() => setScope(id)} style={{
      background: scope === id ? C.violet + "22" : "none", border: `1px solid ${scope === id ? C.violet : C.border}`,
      color: scope === id ? C.violet : C.sub, fontSize: 11, fontWeight: 700, borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit",
    }}>{label}</button>
  );

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ color: C.sub, fontSize: 11, fontWeight: 800, letterSpacing: 0.5 }}>📊 PAPER-RUN SCOREBOARD</span>
        <div style={{ display: "flex", gap: 6 }}>
          <ScopeBtn id="all" label="All" />
          <ScopeBtn id="bot" label="Bot only" />
        </div>
      </div>

      <div style={{ background: v.color + "14", border: `1px solid ${v.color}44`, borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <div style={{ color: v.color, fontSize: 15, fontWeight: 900, marginBottom: 4 }}>{v.label}</div>
        <div style={{ color: C.sub, fontSize: 12, lineHeight: 1.5 }}>{v.note}</div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <Stat label="EV / TRADE" value={`${ev >= 0 ? "+" : ""}${money(ev)}`} color={ev >= 0 ? C.green : C.red} />
        <Stat label="NET P&L" value={`${net >= 0 ? "+" : ""}${money(net)}`} color={net >= 0 ? C.green : C.red} />
        <Stat label="WIN RATE" value={`${rate.toFixed(0)}%`} color={rate >= 50 ? C.green : C.sub} />
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <Stat label="TRADES" value={n} />
        <Stat label="FEES PAID" value={money(fees)} color={C.amber} />
        <Stat label="PROJ / 100" value={`${ev >= 0 ? "+" : ""}${money(ev * 100)}`} color={ev >= 0 ? C.green : C.red} />
      </div>
    </div>
  );
}

function PaperTrade({ btc, btcDir }) {
  const [bal, setBal] = usePersist("kc_bal", 1000);
  const [open, setOpen] = usePersist("kc_open", []);
  const [hist, setHist] = usePersist("kc_hist", []);
  const [auto, setAuto] = usePersist("kc_auto", false);
  const [botStake, setBotStake] = usePersist("kc_botstake", 10);
  const [botThresh, setBotThresh] = usePersist("kc_botthresh", 0);
  const [tp, setTp] = usePersist("kc_tp", 80); // take-profit: sell when mark >= tp cents
  const [sl, setSl] = usePersist("kc_sl", 0);  // stop-loss: sell when mark <= sl cents (0 = off)
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

  // BTC volatility per ~second, estimated from the live feed, to mark positions
  const sigmaPerSec = () => {
    const a = priceHist.current;
    if (a.length < 6) return 4;
    let s = 0, s2 = 0, n = 0;
    for (let i = 1; i < a.length; i++) { const d = a[i].p - a[i - 1].p; s += d; s2 += d * d; n++; }
    return Math.max(0.5, Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)));
  };
  // fair value (0..1) of a position right now: P(it finishes a winner)
  const markFor = (pos) => {
    if (!btc) return null;
    const tLeft = Math.max(1, (pos.settleAt - now) / 1000);
    const sd = sigmaPerSec() * Math.sqrt(tLeft);
    const z = (btc - pos.p0) / (sd || 1);
    return pos.side === "UP" ? ncdf(z) : ncdf(-z);
  };
  // net P&L if sold right now (proceeds − cost − entry fee − sell fee)
  const unrealized = (pos) => {
    const m = markFor(pos);
    if (m == null) return null;
    const markC = Math.max(1, Math.round(m * 100));
    return +(pos.contracts * m - pos.cost - (pos.fee || 0) - kalshiFee(pos.contracts, markC)).toFixed(2);
  };
  // sell an open position now, at its current mark
  const sellNow = (pos) => {
    const m = markFor(pos);
    if (m == null) return;
    const markC = Math.max(1, Math.round(m * 100));
    const sellFee = kalshiFee(pos.contracts, markC);
    const proceeds = +(pos.contracts * m).toFixed(2);
    const pnl = +(proceeds - pos.cost - (pos.fee || 0) - sellFee).toFixed(2);
    setBal((b) => +(b + proceeds - sellFee).toFixed(2));
    setOpen((o) => o.filter((t) => t.id !== pos.id));
    setHist((h) => [{ ...pos, settlePrice: btc, markCents: markC, result: "sold", pnl, soldAt: now }, ...h].slice(0, 60));
  };

  // take-profit / stop-loss: the bot sells before the close when a position's
  // mark hits the target, so it doesn't have to wait out the full 15 minutes.
  useEffect(() => {
    if (!btc) return;
    for (const pos of open) {
      if (!pos.byBot) continue;
      const m = markFor(pos);
      if (m == null) continue;
      const c = m * 100;
      if (tp > 0 && c >= tp) sellNow(pos);
      else if (sl > 0 && c <= sl) sellNow(pos);
    }
  }, [now]);

  // the bot: once per window, near the open, decide a side and paper-trade it.
  // Window end = the real Kalshi close time when we have it, else the clock.
  // With a strong-signal threshold it SKIPS windows where momentum is weak.
  const settleAt = (kalshi.market && kalshi.market.closeTime > now + 60000) ? kalshi.market.closeTime : winEnd(now);
  const botDecided = useRef(0);
  useEffect(() => {
    if (!auto || !btc) return;
    const we = settleAt;
    if (we - now <= 60000) return;                 // too late in this window
    if (botDecided.current === we) return;         // already decided this window
    if (open.some((t) => t.byBot && t.settleAt === we)) { botDecided.current = we; return; }
    const mom = momentum();
    const stamp = new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    if (Math.abs(mom) < botThresh) {               // weak signal -> sit this one out
      botDecided.current = we;
      setBotLog((l) => [`${stamp} · skip — weak signal (${mom >= 0 ? "+" : ""}${mom.toFixed(0)}/2m < $${botThresh})`, ...l].slice(0, 8));
      return;
    }
    const sd = mom >= 0 ? "UP" : "DOWN";
    const e = kalshi.market ? (sd === "UP" ? kalshi.market.upAsk : kalshi.market.downAsk) : entry;
    if (placeTrade(sd, e, botStake, we, true)) {
      botDecided.current = we;
      setBotLog((l) => [`${stamp} · ${sd} @ ${e}¢ — BTC ${mom >= 0 ? "+" : ""}${mom.toFixed(0)}/2m`, ...l].slice(0, 8));
    }
  }, [now, auto]);

  const contracts = Math.max(1, Math.floor(stake / (entry / 100)));
  const cost = +((contracts * entry) / 100).toFixed(2);
  const fee = kalshiFee(contracts, entry);
  const profitIfWin = +(((contracts * (100 - entry)) / 100) - fee).toFixed(2); // net of fee
  const canPlace = !!btc && cost + fee <= bal;
  const manualSettle = (kalshi.market && kalshi.market.closeTime > now + 60000) ? kalshi.market.closeTime : winEnd(now);

  const reset = () => { if (confirm("Reset balance to $1,000 and clear all trades?")) { setBal(1000); setOpen([]); setHist([]); setBotLog([]); } };

  // keep a record across devices / resets
  const download = (name, type, data) => {
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportCsv = () => {
    const rows = [["time", "side", "by", "entry_cents", "contracts", "cost", "fee", "entryBTC", "settleBTC", "result", "net_pnl"]];
    hist.slice().reverse().forEach((t) => rows.push([
      new Date(t.placedAt || t.id).toISOString(), t.side, t.byBot ? "bot" : "manual",
      t.entry, t.contracts, t.cost, t.fee || 0, Math.round(t.p0), Math.round(t.settlePrice), t.result, t.pnl,
    ]));
    download("cockpit-trades.csv", "text/csv", rows.map((r) => r.join(",")).join("\n"));
  };
  const copyJson = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(hist)); alert(`Copied ${hist.length} trades to clipboard.`); }
    catch { download("cockpit-trades.json", "application/json", JSON.stringify(hist)); }
  };
  const importJson = () => {
    const s = window.prompt("Paste exported trade JSON to restore your log:");
    if (!s) return;
    try { const arr = JSON.parse(s); if (Array.isArray(arr)) { setHist(arr); alert(`Loaded ${arr.length} trades.`); } else alert("That isn't a trade list."); }
    catch { alert("Invalid JSON — paste the full exported text."); }
  };

  const atRisk = open.reduce((a, t) => a + t.cost, 0);
  const realized = hist.reduce((a, t) => a + t.pnl, 0);
  const wins = hist.filter((t) => t.pnl > 0).length;
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

      {/* scoreboard — the "prove it" verdict */}
      <Scoreboard hist={hist} />

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
          style={{ width: "100%", accentColor: C.violet, height: 24, marginBottom: 8 }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ color: C.sub, fontSize: 12 }}>Min signal · skip if weaker</span>
          <span style={{ color: C.violet, fontSize: 16, fontWeight: 800 }}>{botThresh === 0 ? "off" : `$${botThresh}`}</span>
        </div>
        <input type="range" min={0} max={300} step={5} value={botThresh} onChange={(e) => setBotThresh(+e.target.value)}
          style={{ width: "100%", accentColor: C.violet, height: 24 }} />
        <div style={{ color: C.dim, fontSize: 11, marginTop: 2, marginBottom: 8 }}>
          {botThresh === 0 ? "Trades every window." : `Only trades when BTC moved >$${botThresh} in the last 2 min — tests whether being selective beats trading blind.`}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ color: C.sub, fontSize: 12 }}>Take profit · sell at</span>
          <span style={{ color: C.green, fontSize: 16, fontWeight: 800 }}>{tp === 0 ? "off" : `${tp}¢`}</span>
        </div>
        <input type="range" min={0} max={99} step={1} value={tp} onChange={(e) => setTp(+e.target.value)}
          style={{ width: "100%", accentColor: C.green, height: 24 }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
          <span style={{ color: C.sub, fontSize: 12 }}>Stop loss · sell at</span>
          <span style={{ color: C.red, fontSize: 16, fontWeight: 800 }}>{sl === 0 ? "off" : `${sl}¢`}</span>
        </div>
        <input type="range" min={0} max={49} step={1} value={sl} onChange={(e) => setSl(+e.target.value)}
          style={{ width: "100%", accentColor: C.red, height: 24 }} />
        <div style={{ color: C.dim, fontSize: 11, marginTop: 2 }}>
          {tp === 0 ? "Bot holds to the close." : `Bot sells early once a position is worth ≥${tp}¢ — locking profit before the 15-min close.`}
        </div>

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
          <span style={{ color: btcDir === "up" ? C.green : btcDir === "down" ? C.red : C.amber, fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums", transition: "color .2s" }}>{btc ? `${btcDir === "up" ? "▲" : btcDir === "down" ? "▼" : ""} ${fmtBtc(btc)}` : "price…"}</span>
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
            const left = t.settleAt - now;
            const col = t.side === "UP" ? C.green : C.red;
            const mark = markFor(t);
            const markC = mark == null ? null : Math.round(mark * 100);
            const unreal = unrealized(t);
            const uCol = unreal == null ? C.sub : unreal > 0 ? C.green : unreal < 0 ? C.red : C.sub;
            return (
              <div key={t.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: col, fontSize: 14, fontWeight: 900 }}>{t.side === "UP" ? "▲" : "▼"} {t.side}{t.byBot ? <span style={{ color: C.violet, fontSize: 11, fontWeight: 800 }}> 🤖</span> : null}</span>
                  <span style={{ color: C.text, fontVariantNumeric: "tabular-nums", fontSize: 14, fontWeight: 800 }}>{cd(left)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                  <div style={{ fontSize: 12, color: C.sub }}>
                    <div>mark <b style={{ color: C.text }}>{markC == null ? "—" : `${markC}¢`}</b> · entry {t.entry}¢</div>
                    <div style={{ color: uCol, fontWeight: 800, marginTop: 2 }}>{unreal == null ? "" : `${unreal >= 0 ? "+" : ""}${money(unreal)} if sold now`}</div>
                  </div>
                  <button onClick={() => sellNow(t)} disabled={!btc} style={{ background: btc ? C.lift : C.card, border: `1px solid ${C.border}`, color: btc ? C.text : C.dim, fontSize: 13, fontWeight: 800, borderRadius: 10, padding: "9px 16px", cursor: btc ? "pointer" : "default", fontFamily: "inherit" }}>Sell</button>
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: C.dim }}>{t.contracts} @ {t.entry}¢ · cost {money(t.cost)} +fee {money(t.fee || 0)} · hold-to-win +{money(+(((t.contracts * (100 - t.entry)) / 100) - (t.fee || 0)).toFixed(2))}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* history */}
      <PnLChart trades={hist.slice().reverse()} />

      <div style={{ margin: "14px 0 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ color: C.sub, fontSize: 12, fontWeight: 700, letterSpacing: 0.4 }}>SETTLED · {hist.length}</span>
          <button onClick={reset} style={{ background: "none", border: `1px solid ${C.border}`, color: C.red, fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontFamily: "inherit" }}>Reset</button>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[["⬇ CSV", exportCsv], ["⧉ Copy JSON", copyJson], ["⬆ Import", importJson]].map(([lbl, fn]) => (
            <button key={lbl} onClick={fn} style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, color: C.sub, fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "8px 6px", cursor: "pointer", fontFamily: "inherit" }}>{lbl}</button>
          ))}
        </div>
      </div>
      {hist.map((t) => (
        <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 13px", marginBottom: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.pnl > 0 ? C.green : t.pnl === 0 ? C.amber : C.red, flexShrink: 0 }} />
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
  const [btcDir, setBtcDir] = useState("flat"); // last tick: up | down | flat
  const [clock, setClock] = useState(laTime());
  const btcPrev = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setClock(laTime()), 1000);
    return () => clearInterval(t);
  }, []);

  // poll the live price every second so it ticks like an exchange
  useEffect(() => {
    let live = true;
    const go = async () => {
      try {
        const r = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot");
        const d = await r.json();
        const p = parseFloat(d?.data?.amount);
        if (!live || isNaN(p)) return;
        const prev = btcPrev.current;
        if (prev != null && p !== prev) setBtcDir(p > prev ? "up" : "down");
        btcPrev.current = p;
        setBtc(p);
      } catch { /* offline — price just holds — */ }
    };
    go();
    const t = setInterval(go, 1000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const btcColor = btcDir === "up" ? C.green : btcDir === "down" ? C.red : C.amber;
  const btcArrow = btcDir === "up" ? "▲" : btcDir === "down" ? "▼" : "";

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
            <div style={{ color: btcColor, fontSize: 20, fontWeight: 900, fontVariantNumeric: "tabular-nums", transition: "color .2s" }}>{btcArrow} {fmtBtc(btc)}</div>
            <div style={{ color: C.sub, fontSize: 11 }}>BTC · live · {clock.split(" ")[0]}</div>
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
        {tab === "paper" && <PaperTrade btc={btc} btcDir={btcDir} />}
        {tab === "strategy" && <Strategy entry={entry} setEntry={setEntry} />}
        {tab === "parlay" && <Parlay />}
        {tab === "log" && <Log trades={trades} setTrades={setTrades} entry={entry} />}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Cockpit />);
