'use strict';

// Virtual paper-trading account. Tracks cash, per-(market,outcome) positions,
// fills, and realized PnL. No shorting: BUY opens/increases a position, SELL
// only reduces a position you already hold (to go the other way, BUY the
// opposite outcome — which is how Polymarket binary markets actually work).

function key(marketId, outcome) {
  return `${marketId}:${outcome}`;
}

class Portfolio {
  constructor(startingBalance) {
    this.startingBalance = startingBalance;
    this.cash = startingBalance;
    this.realizedPnl = 0;
    this.positions = new Map(); // key -> { marketId, outcome, tokenId, shares, avgPrice }
    this.trades = []; // newest first
    this.closedTrades = []; // realized round-trips: { ts, pnl } (oldest first)
  }

  position(marketId, outcome) {
    return this.positions.get(key(marketId, outcome));
  }

  // Apply a fill. Returns the recorded trade, or throws on insufficient funds.
  // `force` bypasses the cash guard (used to mirror real live fills, where the
  // on-chain wallet — not this virtual balance — is the source of truth).
  applyFill({ market, outcome, tokenId, side, shares, price, fee = 0, strategy, reason, force = false }) {
    const k = key(market.id, outcome);
    let pos = this.positions.get(k);

    if (side === 'BUY') {
      const cost = shares * price + fee;
      if (!force && cost > this.cash + 1e-9) throw new Error('insufficient cash');
      this.cash -= cost;
      if (!pos) {
        pos = { marketId: market.id, outcome, tokenId, shares: 0, avgPrice: 0 };
        this.positions.set(k, pos);
      }
      const newShares = pos.shares + shares;
      pos.avgPrice = (pos.avgPrice * pos.shares + price * shares) / newShares;
      pos.shares = newShares;
    } else {
      // SELL — close up to what we hold.
      if (!pos || pos.shares <= 0) throw new Error('no position to sell');
      const sold = Math.min(shares, pos.shares);
      const proceeds = sold * price - fee;
      this.cash += proceeds;
      const realized = sold * (price - pos.avgPrice) - fee;
      this.realizedPnl += realized;
      this.closedTrades.push({ ts: Date.now(), pnl: realized });
      if (this.closedTrades.length > 1000) this.closedTrades.shift();
      pos.shares -= sold;
      shares = sold;
      if (pos.shares <= 1e-9) this.positions.delete(k);
    }

    const trade = {
      ts: Date.now(),
      marketId: market.id,
      question: market.question,
      outcome,
      side,
      shares,
      price,
      notional: shares * price,
      strategy,
      reason,
    };
    this.trades.unshift(trade);
    if (this.trades.length > 500) this.trades.length = 500;
    return trade;
  }

  // Replace cash + positions with externally-observed truth (live mode: real
  // USDC balance and on-chain positions). Trades/realized history are kept.
  // Position objects may carry `question` and `curPrice` for markets that
  // aren't in the current feed window.
  loadSnapshot({ cash, positions }) {
    if (typeof cash === 'number' && isFinite(cash)) this.cash = cash;
    this.positions = new Map();
    for (const p of positions || []) {
      if (!(p.shares > 0)) continue;
      this.positions.set(key(p.marketId, p.outcome), {
        marketId: p.marketId,
        outcome: p.outcome,
        tokenId: p.tokenId,
        shares: p.shares,
        avgPrice: p.avgPrice,
        question: p.question,
        curPrice: p.curPrice,
      });
    }
  }

  // Total notional currently deployed (cost basis of open positions).
  exposure() {
    let sum = 0;
    for (const p of this.positions.values()) sum += p.shares * p.avgPrice;
    return sum;
  }

  // Mark-to-market valuation against current books.
  valuation(marketsById) {
    let positionsValue = 0;
    let unrealizedPnl = 0;
    const positions = [];
    for (const p of this.positions.values()) {
      const m = marketsById.get(p.marketId);
      const mark = m ? (p.outcome === 'YES' ? m.yesBid : m.noBid) : (p.curPrice != null ? p.curPrice : p.avgPrice);
      const value = p.shares * mark;
      const upnl = p.shares * (mark - p.avgPrice);
      positionsValue += value;
      unrealizedPnl += upnl;
      positions.push({
        marketId: p.marketId,
        question: m ? m.question : (p.question || p.marketId),
        outcome: p.outcome,
        shares: p.shares,
        avgPrice: p.avgPrice,
        mark,
        value,
        unrealizedPnl: upnl,
      });
    }
    const equity = this.cash + positionsValue;
    return {
      cash: this.cash,
      positionsValue,
      equity,
      realizedPnl: this.realizedPnl,
      unrealizedPnl,
      totalPnl: equity - this.startingBalance,
      returnPct: ((equity - this.startingBalance) / this.startingBalance) * 100,
      exposure: this.exposure(),
      positions: positions.sort((a, b) => b.value - a.value),
    };
  }
}

module.exports = { Portfolio };
