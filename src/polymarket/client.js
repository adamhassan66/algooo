'use strict';

// Live Polymarket source. Talks to the public REST APIs (no auth required for
// market data, prices, leaderboard, and wallet activity). Implements the same
// interface as MockSource so the feed can swap between them transparently.
//
// Read-only: this client never signs or submits orders. Paper trades are
// simulated locally in the engine against these live prices.

const config = require('./../config');
const log = require('../util/logger');

const TIMEOUT_MS = 8000;

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const numOr = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

class LiveSource {
  constructor() {
    this.kind = 'live';
    this._tokenIndex = new Map(); // tokenId -> { marketId, outcome }
    this._seenTrades = new Set();
  }

  // Pull active, liquid binary markets from the Gamma API.
  async loadMarkets() {
    const url = `${config.endpoints.gamma}/markets?active=true&closed=false&limit=40&order=volume24hr&ascending=false`;
    const raw = await getJson(url);
    const markets = [];
    for (const m of raw) {
      let tokens;
      try {
        tokens = Array.isArray(m.clobTokenIds) ? m.clobTokenIds : JSON.parse(m.clobTokenIds || '[]');
      } catch {
        tokens = [];
      }
      if (tokens.length !== 2) continue; // binary markets only
      const [yesTokenId, noTokenId] = tokens;
      const market = {
        id: String(m.conditionId || m.id),
        slug: m.slug,
        question: m.question,
        endDate: m.endDate,
        volume24h: numOr(m.volume24hr, 0),
        liquidity: numOr(m.liquidity, 0),
        yesTokenId,
        noTokenId,
        yesBid: 0, yesAsk: 0, noBid: 0, noAsk: 0,
        updatedAt: Date.now(),
      };
      this._tokenIndex.set(yesTokenId, { marketId: market.id, outcome: 'YES' });
      this._tokenIndex.set(noTokenId, { marketId: market.id, outcome: 'NO' });
      markets.push(market);
    }
    if (!markets.length) throw new Error('Gamma returned no binary markets');
    await this._refreshPrices(markets);
    return markets;
  }

  tick(markets) {
    // Fire and forget price refresh; engine reads the latest values each tick.
    this._refreshPrices(markets).catch((e) => log.warn('price refresh failed:', e.message));
    return markets;
  }

  // Pull best bid/ask per token from the CLOB book endpoint.
  async _refreshPrices(markets) {
    await Promise.all(
      markets.map(async (m) => {
        try {
          const [yesBook, noBook] = await Promise.all([
            getJson(`${config.endpoints.clob}/book?token_id=${m.yesTokenId}`),
            getJson(`${config.endpoints.clob}/book?token_id=${m.noTokenId}`),
          ]);
          const top = (book, side) => {
            const levels = book && book[side];
            if (!Array.isArray(levels) || !levels.length) return 0;
            // bids are sorted ascending, asks ascending; take best.
            const best = side === 'bids' ? levels[levels.length - 1] : levels[0];
            return numOr(best && best.price, 0);
          };
          m.yesBid = top(yesBook, 'bids');
          m.yesAsk = top(yesBook, 'asks');
          m.noBid = top(noBook, 'bids');
          m.noAsk = top(noBook, 'asks');
          m.updatedAt = Date.now();
        } catch {
          /* leave last-known prices on transient failure */
        }
      })
    );
  }

  async loadLeaderboard() {
    const url = `${config.endpoints.leaderboard}/leaderboard?window=all&limit=10&orderBy=pnl`;
    const raw = await getJson(url);
    const rows = Array.isArray(raw) ? raw : raw.data || [];
    return rows.map((r) => ({
      wallet: String(r.proxyWallet || r.wallet || r.address || '').toLowerCase(),
      name: r.name || r.pseudonym || r.username || 'anon',
      pnl: numOr(r.pnl || r.amount, 0),
    }));
  }

  // Recent BUY/SELL activity for the tracked wallets.
  async pollSourceTrades(markets, wallets) {
    const out = [];
    const byMarket = new Map(markets.map((m) => [m.id, m]));
    for (const wallet of wallets) {
      let activity;
      try {
        activity = await getJson(`${config.endpoints.data}/activity?user=${wallet}&limit=10&type=TRADE`);
      } catch {
        continue;
      }
      for (const a of activity || []) {
        const key = a.transactionHash || a.id || `${wallet}:${a.timestamp}:${a.asset}`;
        if (this._seenTrades.has(key)) continue;
        this._seenTrades.add(key);
        const ref = this._tokenIndex.get(a.asset);
        const market = ref && byMarket.get(ref.marketId);
        if (!market) continue;
        out.push({
          id: key,
          wallet,
          trader: a.name || wallet.slice(0, 8),
          marketId: market.id,
          question: market.question,
          outcome: ref.outcome,
          side: (a.side || 'BUY').toUpperCase(),
          price: numOr(a.price, 0),
          sizeUsd: numOr(a.usdcSize || a.size, 0),
          ts: numOr(a.timestamp, Date.now()) * (a.timestamp > 1e12 ? 1 : 1000),
        });
      }
    }
    return out;
  }
}

module.exports = { LiveSource };
