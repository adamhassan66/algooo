/*
*   Kalshi weather-market edge finder.
*
*   The "boring weather markets print money" pitch has one real kernel:
*   weather markets are thin and inefficiently priced, AND there is a free,
*   objective forecast model (NOAA/ECMWF, served by Open-Meteo) you can price
*   against. The paid Telegram signal bot in that pitch is ignored here.
*
*   Why Kalshi (vs Polymarket) is the better target:
*   Kalshi temperature markets expose STRUCTURED strike fields
*   (strike_type, floor_strike, cap_strike), so we read the threshold
*   directly instead of regex-guessing it from the question text. Kalshi is
*   also a CFTC-regulated US exchange, and its weather markets settle on a
*   defined NWS station, which is exactly what an objective forecast prices.
*
*   Strategy this implements, plainly:
*     1. Pull open weather markets from Kalshi (per known temperature series).
*     2. Turn the forecast high into a probability with a normal model around
*        it (a point forecast of 88F is NOT a 100% "over 85F").
*     3. edge = model probability - market implied probability.
*     4. Rank by edge, sized by open interest. Positive edge = market too cheap.
*
*   The math below is pure and unit-tested offline (run: `node kalshi-weather.js`).
*   The live fetch needs open network (run: `node kalshi-weather.js --live`).
*
*   NOT FINANCIAL ADVICE. A model edge is a hypothesis, not a guarantee. The
*   market may know something your forecast doesn't (station definition,
*   settlement timing). Verify on Kalshi before risking money.
*/

// ---------------------------------------------------------------------------
// Pure math: forecast -> probability
// ---------------------------------------------------------------------------

// erf via Abramowitz & Stegun 7.1.26 (max error ~1.5e-7) so we don't need deps
const erf = (x) => {
  const sign = x < 0 ? -1 : 1
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return sign * y
}

// standard normal CDF: P(Z <= z)
const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2))

// P(value > threshold) given a normal forecast with the given mean and stddev.
const probAbove = (threshold, mean, sd) => 1 - normalCdf((threshold - mean) / sd)
const probBelow = (threshold, mean, sd) => normalCdf((threshold - mean) / sd)

// P(low <= value <= high) for Kalshi "between" bucket markets
const probBetween = (low, high, mean, sd) =>
  normalCdf((high - mean) / sd) - normalCdf((low - mean) / sd)

// Forecast error grows with lead time. Crude but honest: floor of 2F, plus
// ~1.1F per day out. A market resolving in 5 days isn't a sure thing.
const forecastSd = (daysOut) =>
  Math.max(2, Math.round(1.1 * Math.max(0, daysOut) * 10) / 10)

// ---------------------------------------------------------------------------
// Pure logic: edge + position sizing
// ---------------------------------------------------------------------------

const edge = (modelProb, marketProb) => modelProb - marketProb

// Fractional Kelly for a binary YES at price p when you believe prob is m.
// Returns fraction of bankroll; clamped to >=0. Use ~1/4 of this in practice.
const kelly = (modelProb, price) => {
  if (price <= 0 || price >= 1) return 0
  const b = (1 - price) / price
  const f = (b * modelProb - (1 - modelProb)) / b
  return Math.max(0, f)
}

// Reward edge but temper it by depth so we don't chase edges we can't fill.
const rankScore = (e, openInterest) =>
  Math.abs(e) * Math.sqrt(Math.max(0, openInterest))

// ---------------------------------------------------------------------------
// Kalshi-specific parsing (structured fields, no text regex needed)
// ---------------------------------------------------------------------------

// Kalshi temperature series ticker prefix -> NWS station coords for forecasts.
// Both the legacy (HIGHxx) and newer KX-prefixed series are listed.
const SERIES = {
  HIGHNY:   { lat: 40.78, lon: -73.97, label: 'New York (Central Park)' },
  KXHIGHNY: { lat: 40.78, lon: -73.97, label: 'New York (Central Park)' },
  HIGHLAX:  { lat: 33.94, lon: -118.41, label: 'Los Angeles (LAX)' },
  KXHIGHLAX:{ lat: 33.94, lon: -118.41, label: 'Los Angeles (LAX)' },
  HIGHCHI:  { lat: 41.99, lon: -87.91, label: 'Chicago (O\'Hare)' },
  KXHIGHCHI:{ lat: 41.99, lon: -87.91, label: 'Chicago (O\'Hare)' },
  HIGHMIA:  { lat: 25.79, lon: -80.32, label: 'Miami' },
  KXHIGHMIA:{ lat: 25.79, lon: -80.32, label: 'Miami' },
  HIGHAUS:  { lat: 30.19, lon: -97.67, label: 'Austin (AUS)' },
  KXHIGHAUS:{ lat: 30.19, lon: -97.67, label: 'Austin (AUS)' },
  HIGHDEN:  { lat: 39.85, lon: -104.67, label: 'Denver (DEN)' },
  KXHIGHDEN:{ lat: 39.85, lon: -104.67, label: 'Denver (DEN)' },
  HIGHPHIL: { lat: 39.87, lon: -75.24, label: 'Philadelphia (PHL)' },
  KXHIGHPHIL:{ lat: 39.87, lon: -75.24, label: 'Philadelphia (PHL)' },
}

// Longest keys first so KXHIGHNY matches before HIGHNY.
const SERIES_KEYS = Object.keys(SERIES).sort((a, b) => b.length - a.length)

// Which city/station does this market belong to? Reads the ticker prefix.
const cityFor = (m) => {
  const tk = (m.event_ticker || m.ticker || '').toUpperCase()
  for (const key of SERIES_KEYS) if (tk.startsWith(key)) return SERIES[key]
  return null
}

// Turn a Kalshi market's strike fields into what we need to price.
// Kalshi strike_type is one of: greater, greater_or_equal, less,
// less_or_equal, between. Falls back to whichever strikes are present.
const parseKalshiStrike = (m) => {
  const t = (m.strike_type || '').toLowerCase()
  if (t === 'greater' || t === 'greater_or_equal')
    return { kind: 'above', threshold: m.floor_strike }
  if (t === 'less' || t === 'less_or_equal')
    return { kind: 'below', threshold: m.cap_strike }
  if (t === 'between')
    return { kind: 'between', low: m.floor_strike, high: m.cap_strike }
  if (m.floor_strike != null && m.cap_strike != null)
    return { kind: 'between', low: m.floor_strike, high: m.cap_strike }
  if (m.floor_strike != null) return { kind: 'above', threshold: m.floor_strike }
  if (m.cap_strike != null) return { kind: 'below', threshold: m.cap_strike }
  return null
}

// Kalshi quotes are in cents (1..99). Prefer the bid/ask midpoint; fall back
// to last traded price. Returns an implied YES probability in [0,1], or null.
const impliedYes = (m) => {
  const bid = +m.yes_bid || 0
  const ask = +m.yes_ask || 0
  if (bid > 0 && ask > 0) return (bid + ask) / 200
  if (+m.last_price > 0) return +m.last_price / 100
  return null
}

// Given a parsed strike and a forecast high, compute the model probability.
const modelProbFor = (parsed, forecastHigh, daysOut) => {
  const sd = forecastSd(daysOut)
  if (parsed.kind === 'above') return probAbove(parsed.threshold, forecastHigh, sd)
  if (parsed.kind === 'below') return probBelow(parsed.threshold, forecastHigh, sd)
  if (parsed.kind === 'between') return probBetween(parsed.low, parsed.high, forecastHigh, sd)
  return null
}

// ---------------------------------------------------------------------------
// Live mode: fetch real Kalshi markets + forecasts (needs open network)
// ---------------------------------------------------------------------------

const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2'

// Public market-data reads don't need auth; order placement does. If Kalshi
// returns 401 here, set KALSHI_TOKEN and we'll send it as a bearer token.
const kalshiHeaders = () => {
  const h = { 'Accept': 'application/json' }
  if (process.env.KALSHI_TOKEN) h['Authorization'] = `Bearer ${process.env.KALSHI_TOKEN}`
  return h
}

const fetchSeriesMarkets = async (series) => {
  const out = []
  let cursor = ''
  do {
    const url = `${KALSHI}/markets?series_ticker=${series}&status=open&limit=200` +
      (cursor ? `&cursor=${cursor}` : '')
    const res = await fetch(url, { headers: kalshiHeaders() })
    if (res.status === 404) return out      // series doesn't exist under this name
    if (!res.ok) throw new Error(`Kalshi ${res.status} for ${series}`)
    const j = await res.json()
    out.push(...(j.markets || []))
    cursor = j.cursor || ''
  } while (cursor)
  return out
}

const fetchForecastHigh = async (city, dateISO) => {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}` +
    `&longitude=${city.lon}&daily=temperature_2m_max&temperature_unit=fahrenheit` +
    `&timezone=auto&start_date=${dateISO}&end_date=${dateISO}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
  const data = await res.json()
  return data?.daily?.temperature_2m_max?.[0] ?? null
}

const daysUntil = (endISO) =>
  Math.round((new Date(endISO) - Date.now()) / 86400000)

const runLive = async () => {
  console.log('Fetching open Kalshi weather markets...')
  const seen = new Set()
  const markets = []
  for (const series of SERIES_KEYS) {
    let page
    try { page = await fetchSeriesMarkets(series) }
    catch (e) { console.error(`  skip ${series}: ${e.message}`); continue }
    for (const m of page) {
      if (m.ticker && !seen.has(m.ticker)) { seen.add(m.ticker); markets.push(m) }
    }
  }
  console.log(`Found ${markets.length} open temperature markets.\n`)

  const rows = []
  for (const m of markets) {
    const city = cityFor(m)
    const parsed = parseKalshiStrike(m)
    if (!city || !parsed) continue
    const endISO = (m.close_time || '').slice(0, 10)
    if (!endISO) continue
    const daysOut = daysUntil(endISO)
    if (daysOut < 0 || daysOut > 10) continue   // forecasts past ~10d are noise

    const yes = impliedYes(m)
    if (yes == null) continue

    let high
    try { high = await fetchForecastHigh(city, endISO) }
    catch { continue }
    if (high == null) continue

    const modelProb = modelProbFor(parsed, high, daysOut)
    const e = edge(modelProb, yes)
    const oi = +m.open_interest || 0
    rows.push({
      ticker: m.ticker,
      title: m.title || m.ticker,
      city: city.label,
      forecastHigh: high,
      modelProb: +modelProb.toFixed(3),
      yes,
      edge: +e.toFixed(3),
      kelly: +kelly(modelProb, yes).toFixed(3),
      oi,
      volume: +m.volume || 0,
      score: rankScore(e, oi),
    })
  }

  rows.sort((a, b) => b.score - a.score)
  console.log(`Priceable markets with an edge (best first):\n`)
  for (const r of rows.slice(0, 20)) {
    const side = r.edge > 0 ? 'BUY YES' : 'BUY NO '
    console.log(
      `${side} edge=${(r.edge * 100).toFixed(1)}pp  ` +
      `model=${(r.modelProb * 100).toFixed(0)}% mkt=${(r.yes * 100).toFixed(0)}c  ` +
      `fHigh=${r.forecastHigh}F oi=${r.oi}  ¼kelly=${(0.25 * r.kelly * 100).toFixed(1)}%\n` +
      `   ${r.title}  [${r.ticker}]`
    )
  }
  if (!rows.length) console.log('  (none priceable right now)')
}

// ---------------------------------------------------------------------------
// Offline self-tests (repo convention: console.log + expected output)
// ---------------------------------------------------------------------------

const runTests = () => {
  // normalCdf(0)=0.5  -> should print 0.5000
  console.log(normalCdf(0).toFixed(4))

  // forecast high 88F, sd 3F, P(high > 90) -> should print ~0.252
  console.log(probAbove(90, 88, 3).toFixed(3))

  // same forecast, P(high < 85) -> should print ~0.159
  console.log(probBelow(85, 88, 3).toFixed(3))

  // P(high lands in 86-90 bucket) around an 88F forecast -> should print ~0.495
  console.log(probBetween(86, 90, 88, 3).toFixed(3))

  // forecast error widens with lead time -> should print [ 2, 2, 3.3, 5.5 ]
  console.log([forecastSd(0), forecastSd(1), forecastSd(3), forecastSd(5)])

  // model 25% vs market 15c -> +10pp -> should print 0.1
  console.log(+edge(0.25, 0.15).toFixed(3))

  // Kelly for 25% belief at 15c (positive edge) -> should print ~0.118
  console.log(+kelly(0.25, 0.15).toFixed(3))

  // Kelly with no edge -> should print 0
  console.log(kelly(0.15, 0.15))

  // A realistic Kalshi NYC market object, "high > 90F"
  const mkt = {
    event_ticker: 'KXHIGHNY-25JUN28', ticker: 'KXHIGHNY-25JUN28-T90',
    strike_type: 'greater', floor_strike: 90,
    yes_bid: 12, yes_ask: 16, last_price: 14,
    open_interest: 800, volume: 1500, close_time: '2025-06-28T20:00:00Z',
  }
  // structured strike -> should print { kind: 'above', threshold: 90 }
  console.log(parseKalshiStrike(mkt))

  // ticker prefix -> station -> should print New York (Central Park)
  console.log(cityFor(mkt).label)

  // bid/ask midpoint (12,16)c -> should print 0.14
  console.log(impliedYes(mkt))

  // end-to-end: that market, forecast high 88F, 2 days out (sd=2.2)
  // should print ~0.182
  const parsed = parseKalshiStrike(mkt)
  console.log(+modelProbFor(parsed, 88, 2).toFixed(3))

  // a "between" bucket market parses both strikes
  // should print { kind: 'between', low: 85, high: 89 }
  console.log(parseKalshiStrike({ strike_type: 'between', floor_strike: 85, cap_strike: 89 }))

  // a non-weather ticker has no station -> should print null
  console.log(cityFor({ event_ticker: 'PRES-2028-DJT' }))
}

// ---------------------------------------------------------------------------

if (process.argv.includes('--live')) {
  runLive().catch((err) => {
    console.error('Live mode failed:', err.message)
    console.error('This environment may block outbound network (see proxy policy).')
    console.error('Run on a machine with open network, or loosen the env network policy.')
    process.exit(1)
  })
} else {
  runTests()
}

module.exports = {
  erf, normalCdf, probAbove, probBelow, probBetween, forecastSd,
  edge, kelly, rankScore, SERIES, cityFor, parseKalshiStrike,
  impliedYes, modelProbFor,
}
