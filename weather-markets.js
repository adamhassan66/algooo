/*
*   Polymarket weather-market edge finder.
*
*   The "boring weather markets print money" pitch has one real kernel:
*   weather markets are thin and inefficiently priced, AND there is a free,
*   objective forecast model (NOAA/ECMWF, served by Open-Meteo) you can price
*   against. Everything else in that pitch (a paid Telegram signal bot,
*   "watch this wallet", unverifiable PnL) is a funnel and is ignored here.
*
*   Strategy this implements, plainly:
*     1. Pull active weather markets from Polymarket (Gamma API).
*     2. For temperature markets, turn a forecast into a probability with a
*        normal model around the forecast high (forecasts have error, so a
*        point forecast of 88F is NOT a 100% "over 85F").
*     3. edge = model probability - market implied probability.
*     4. Rank by edge, sized by liquidity. Positive edge = market too cheap.
*
*   The math below is pure and unit-tested offline (run: `node weather-markets.js`).
*   The live fetch needs open network (run: `node weather-markets.js --live`).
*
*   NOT FINANCIAL ADVICE. A model edge is a hypothesis, not a guarantee; the
*   market may know something your forecast doesn't (station definition,
*   resolution source, settlement timing). Verify before risking money.
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
// sd is the typical day-ahead forecast error; ~3F for next-day high temp is a
// reasonable default and it WIDENS the further out the market resolves.
const probAbove = (threshold, mean, sd) => 1 - normalCdf((threshold - mean) / sd)
const probBelow = (threshold, mean, sd) => normalCdf((threshold - mean) / sd)

// P(low < value < high) for "bucket" markets (e.g. high lands in 85-89F)
const probBetween = (low, high, mean, sd) =>
  normalCdf((high - mean) / sd) - normalCdf((low - mean) / sd)

// Forecast error grows with lead time. Crude but honest: floor of 2F, plus
// ~1.1F per day out. A market resolving in 5 days isn't a sure thing.
const forecastSd = (daysOut) =>
  Math.max(2, Math.round(1.1 * Math.max(0, daysOut) * 10) / 10)

// ---------------------------------------------------------------------------
// Pure logic: edge + position sizing
// ---------------------------------------------------------------------------

// Polymarket's outcomePrices ARE the implied probability already (0..1).
const edge = (modelProb, marketProb) => modelProb - marketProb

// Fractional Kelly for a binary YES at price p when you believe prob is m.
// Returns fraction of bankroll; clamped to >=0 (no edge => no bet). Use a
// fraction (e.g. 0.25) of this in practice — full Kelly is too aggressive.
const kelly = (modelProb, price) => {
  if (price <= 0 || price >= 1) return 0
  const b = (1 - price) / price        // net odds on a YES share
  const f = (b * modelProb - (1 - modelProb)) / b
  return Math.max(0, f)
}

// Rank score: reward edge but don't chase edges in illiquid markets you can't
// actually fill. sqrt(liquidity) tempers the weighting.
const rankScore = (e, liquidity) => Math.abs(e) * Math.sqrt(Math.max(0, liquidity))

// ---------------------------------------------------------------------------
// Pure parsing: market question -> what to price
// ---------------------------------------------------------------------------

// Cities that show up in Polymarket weather markets -> coordinates for forecasts
const CITIES = {
  nyc:        { lat: 40.78, lon: -73.97, label: 'New York (Central Park)' },
  'new york': { lat: 40.78, lon: -73.97, label: 'New York (Central Park)' },
  la:         { lat: 33.94, lon: -118.41, label: 'Los Angeles (LAX)' },
  'los angeles': { lat: 33.94, lon: -118.41, label: 'Los Angeles (LAX)' },
  chicago:    { lat: 41.99, lon: -87.91, label: 'Chicago (O\'Hare)' },
  london:     { lat: 51.48, lon: -0.45, label: 'London (Heathrow)' },
  miami:      { lat: 25.79, lon: -80.32, label: 'Miami' },
}

// Try to understand a temperature market. Returns null if we can't price it
// confidently — better to skip than to bet on a misread question.
const parseTempMarket = (question) => {
  const q = question.toLowerCase()
  if (!/temp|degrees|°|fahrenheit|\bhigh\b/.test(q)) return null

  let city = null
  for (const name of Object.keys(CITIES)) {
    if (q.includes(name)) { city = CITIES[name]; break }
  }
  if (!city) return null

  // bucket: "between 85 and 89", "85-89", "85 to 89"
  const bucket = q.match(/(\d{2,3})\s*(?:-|to|and)\s*(\d{2,3})/)
  if (bucket) {
    return { city, kind: 'between', low: +bucket[1], high: +bucket[2] }
  }
  // threshold: "above/over/at least 90", "below/under 90"
  const m = q.match(/(above|over|at least|more than|below|under|less than)\s*(\d{2,3})/)
  if (m) {
    const dir = /above|over|at least|more than/.test(m[1]) ? 'above' : 'below'
    return { city, kind: dir, threshold: +m[2] }
  }
  return null
}

// Given a parsed market and a forecast high, compute the model probability.
const modelProbFor = (parsed, forecastHigh, daysOut) => {
  const sd = forecastSd(daysOut)
  if (parsed.kind === 'above') return probAbove(parsed.threshold, forecastHigh, sd)
  if (parsed.kind === 'below') return probBelow(parsed.threshold, forecastHigh, sd)
  if (parsed.kind === 'between') return probBetween(parsed.low, parsed.high, forecastHigh, sd)
  return null
}

// ---------------------------------------------------------------------------
// Live mode: fetch real markets + forecasts (needs open network)
// ---------------------------------------------------------------------------

const WEATHER_KEYWORDS = /temperature|temp\b|weather|rain|snow|degrees|fahrenheit|celsius|hottest|coldest|°/i

const fetchWeatherMarkets = async () => {
  // Gamma is paginated; pull a few pages of open markets and keyword-filter.
  const out = []
  for (let offset = 0; offset < 2000; offset += 500) {
    const url = `https://gamma-api.polymarket.com/markets?closed=false&limit=500&offset=${offset}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Gamma ${res.status} at offset ${offset}`)
    const page = await res.json()
    if (!page.length) break
    for (const m of page) {
      if (WEATHER_KEYWORDS.test(m.question || '')) out.push(m)
    }
  }
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
  console.log('Fetching open weather markets from Polymarket...')
  const markets = await fetchWeatherMarkets()
  console.log(`Found ${markets.length} weather-related markets.\n`)

  const rows = []
  for (const m of markets) {
    const parsed = parseTempMarket(m.question || '')
    if (!parsed) continue
    const endISO = (m.endDate || '').slice(0, 10)
    if (!endISO) continue
    const daysOut = daysUntil(endISO)
    if (daysOut < 0 || daysOut > 10) continue   // forecasts past ~10d are noise

    let high
    try { high = await fetchForecastHigh(parsed.city, endISO) }
    catch { continue }
    if (high == null) continue

    // outcomePrices is a JSON string like '["0.62","0.38"]'; [0] is YES.
    let yesPrice
    try { yesPrice = +JSON.parse(m.outcomePrices)[0] } catch { continue }

    const modelProb = modelProbFor(parsed, high, daysOut)
    const e = edge(modelProb, yesPrice)
    const liquidity = +m.liquidity || 0
    rows.push({
      question: m.question,
      city: parsed.city.label,
      forecastHigh: high,
      modelProb: +modelProb.toFixed(3),
      yesPrice,
      edge: +e.toFixed(3),
      kelly: +kelly(modelProb, yesPrice).toFixed(3),
      liquidity,
      score: rankScore(e, liquidity),
    })
  }

  rows.sort((a, b) => b.score - a.score)
  console.log(`Priceable markets with an edge (best first):\n`)
  for (const r of rows.slice(0, 20)) {
    const side = r.edge > 0 ? 'BUY YES' : 'BUY NO '
    console.log(
      `${side} edge=${(r.edge * 100).toFixed(1)}pp  ` +
      `model=${(r.modelProb * 100).toFixed(0)}% mkt=${(r.yesPrice * 100).toFixed(0)}%  ` +
      `fHigh=${r.forecastHigh}F liq=$${Math.round(r.liquidity)}  ` +
      `kelly=${(r.kelly * 100).toFixed(1)}%\n   ${r.question}`
    )
  }
  if (!rows.length) console.log('  (none priceable right now)')
}

// ---------------------------------------------------------------------------
// Offline self-tests (the repo convention: console.log + expected output)
// ---------------------------------------------------------------------------

const runTests = () => {
  // erf(0)=0, normalCdf(0)=0.5
  // should print 0.5
  console.log(normalCdf(0).toFixed(4))

  // A forecast high of 88F, sd 3F. P(high > 90) is unlikely-ish.
  // should print ~0.252
  console.log(probAbove(90, 88, 3).toFixed(3))

  // Same forecast, P(high < 85).
  // should print ~0.159
  console.log(probBelow(85, 88, 3).toFixed(3))

  // P(high lands in the 86-90 bucket) around an 88F forecast.
  // should print ~0.495
  console.log(probBetween(86, 90, 88, 3).toFixed(3))

  // forecast error widens with lead time: floor 2, then ~1.1/day
  // should print [ 2, 2, 3.3, 5.5 ]
  console.log([forecastSd(0), forecastSd(1), forecastSd(3), forecastSd(5)])

  // edge: model thinks 25%, market prices YES at 15% -> +10pp, market too cheap
  // should print 0.1
  console.log(+edge(0.25, 0.15).toFixed(3))

  // Kelly for a 25% belief at a 15c YES price (positive edge -> positive size)
  // should print ~0.118
  console.log(+kelly(0.25, 0.15).toFixed(3))

  // Kelly when you have NO edge (belief == price) -> 0
  // should print 0
  console.log(kelly(0.15, 0.15))

  // parse a real-shaped question into something priceable
  // should print { kind: 'above', threshold: 90, city: 'New York (Central Park)' }
  const p = parseTempMarket('Will the high temperature in NYC be above 90F on June 28?')
  console.log({ kind: p.kind, threshold: p.threshold, city: p.city.label })

  // end-to-end: that NYC market, forecast high 88F, 2 days out (sd=2.2)
  // should print ~0.182
  console.log(+modelProbFor(p, 88, 2).toFixed(3))

  // a non-weather question is correctly ignored
  // should print null
  console.log(parseTempMarket('Will Bitcoin close above 100k?'))
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
  edge, kelly, rankScore, parseTempMarket, modelProbFor,
}
