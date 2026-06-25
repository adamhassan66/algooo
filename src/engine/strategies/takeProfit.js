'use strict';

// Take-profit / stop-loss exits — the engine behind "small fast gains". Each
// tick it marks every open position against the current bid (what you'd get
// selling now) and emits a SELL to close it when:
//   - the gain reaches takeProfitPct  → lock the small win, or
//   - the loss reaches stopLossPct     → cut the loser (0 disables).
// This is what turns the entry strategies into a scalper that recycles a small
// balance quickly instead of accumulating open risk.
const config = require('../../config');

class TakeProfitStrategy {
  constructor() {
    this.name = 'takeProfit';
  }

  evaluate(markets, portfolio) {
    const byId = new Map(markets.map((m) => [m.id, m]));
    const signals = [];
    for (const pos of portfolio.positions.values()) {
      if (!(pos.avgPrice > 0) || !(pos.shares > 0)) continue;
      const m = byId.get(pos.marketId);
      if (!m) continue;
      const bid = pos.outcome === 'YES' ? m.yesBid : m.noBid;
      if (!bid) continue;

      const gain = (bid - pos.avgPrice) / pos.avgPrice;
      let reason = null;
      if (gain >= config.takeProfitPct) reason = `take-profit +${(gain * 100).toFixed(1)}%`;
      else if (config.stopLossPct > 0 && gain <= -config.stopLossPct) reason = `stop-loss ${(gain * 100).toFixed(1)}%`;
      if (!reason) continue;

      signals.push({
        marketId: pos.marketId,
        outcome: pos.outcome,
        side: 'SELL',
        // slightly over full value; the executor clamps SELLs to shares held.
        sizeUsd: pos.shares * bid * 1.05,
        strategy: this.name,
        reason,
      });
    }
    return signals;
  }
}

module.exports = { TakeProfitStrategy };
