'use strict';

// Mock market source. Produces a realistic set of binary Polymarket-style
// markets, random-walking prices, occasional cross-outcome arbitrage windows,
// a fake leaderboard, and a stream of "source" trades for copy-trading.
//
// Implements the same interface as LiveSource:
//   loadMarkets()      -> Promise<Market[]>
//   tick(markets)      -> Market[]            (mutates/returns updated prices)
//   loadLeaderboard()  -> Promise<Trader[]>
//   pollSourceTrades() -> Promise<SourceTrade[]>

const QUESTIONS = [
  'Will BTC close above $100k this month?',
  'Will the Fed cut rates at the next meeting?',
  'Will Team A win the championship?',
  'Will Candidate X win the election?',
  'Will the new film gross $200M opening weekend?',
  'Will it rain in NYC on launch day?',
  'Will the merger be approved by regulators?',
  'Will ETH flip $5k before quarter end?',
  'Will the GDP print beat expectations?',
  'Will the rocket launch succeed on the first attempt?',
  'Will the bill pass the senate this week?',
  'Will unemployment fall below 4%?',
];

let _id = 0;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function makeBook(yesMid, spread) {
  // Derive top-of-book quotes for both outcomes from a YES midpoint.
  const noMid = 1 - yesMid;
  const half = spread / 2;
  return {
    yesBid: clamp(yesMid - half, 0.01, 0.99),
    yesAsk: clamp(yesMid + half, 0.01, 0.99),
    noBid: clamp(noMid - half, 0.01, 0.99),
    noAsk: clamp(noMid + half, 0.01, 0.99),
  };
}

function buildMarket(question) {
  const id = `mkt_${++_id}`;
  const yesMid = rand(0.2, 0.8);
  const spread = rand(0.005, 0.02); // tight, liquid-market-like spreads
  return {
    id,
    slug: id,
    question,
    endDate: new Date(Date.now() + rand(2, 60) * 86400000).toISOString(),
    volume24h: Math.round(rand(5e4, 5e6)),
    liquidity: Math.round(rand(1e4, 1e6)),
    yesTokenId: `${id}_YES`,
    noTokenId: `${id}_NO`,
    _yesMid: yesMid,
    _spread: spread,
    _drift: rand(-0.004, 0.004), // persistent trend, like real intraday markets

    ...makeBook(yesMid, spread),
    updatedAt: Date.now(),
  };
}

const TRADERS = [
  { wallet: '0xa1f0market9maker0000000000000000000001', name: 'AlphaWhale', pnl: 482300 },
  { wallet: '0xb2c3edgehunter000000000000000000000002', name: 'EdgeHunter', pnl: 311740 },
  { wallet: '0xc3d4sharp00trader00000000000000000003', name: 'SharpTrader', pnl: 205900 },
  { wallet: '0xd4e5quant00bot0000000000000000000004', name: 'QuantBot', pnl: 168420 },
  { wallet: '0xe5f6value00seeker0000000000000000005', name: 'ValueSeeker', pnl: 99120 },
];

class MockSource {
  constructor() {
    this.kind = 'mock';
    this._tradeSeq = 0;
  }

  async loadMarkets() {
    return QUESTIONS.map(buildMarket);
  }

  // Advance one tick: random-walk each YES midpoint, occasionally open an
  // arbitrage window where YES_ask + NO_ask dips below 1.
  tick(markets) {
    for (const m of markets) {
      // trend (drift) + noise; the drift occasionally flips direction.
      if (Math.random() < 0.04) m._drift = rand(-0.004, 0.004);
      m._yesMid = clamp(m._yesMid + m._drift + rand(-0.01, 0.01), 0.03, 0.97);
      m._spread = clamp(m._spread + rand(-0.003, 0.003), 0.005, 0.03);
      Object.assign(m, makeBook(m._yesMid, m._spread));

      // ~3% chance per tick to briefly misprice the two books into an arb.
      if (Math.random() < 0.03) {
        const dip = rand(0.02, 0.05);
        m.noAsk = clamp(1 - m.yesAsk - dip, 0.01, 0.99);
      }
      m.updatedAt = Date.now();
    }
    return markets;
  }

  async loadLeaderboard() {
    return TRADERS.map((t) => ({ ...t }));
  }

  // Emit 0-2 random trades from tracked-eligible wallets each poll.
  async pollSourceTrades(markets) {
    const out = [];
    const n = Math.random() < 0.5 ? 0 : Math.random() < 0.7 ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const trader = TRADERS[Math.floor(Math.random() * TRADERS.length)];
      const m = markets[Math.floor(Math.random() * markets.length)];
      if (!m) continue;
      const outcome = Math.random() < 0.5 ? 'YES' : 'NO';
      const price = outcome === 'YES' ? m.yesAsk : m.noAsk;
      out.push({
        id: `src_${++this._tradeSeq}`,
        wallet: trader.wallet,
        trader: trader.name,
        marketId: m.id,
        question: m.question,
        outcome,
        side: 'BUY',
        price,
        sizeUsd: Math.round(rand(100, 5000)),
        ts: Date.now(),
      });
    }
    return out;
  }
}

module.exports = { MockSource };
