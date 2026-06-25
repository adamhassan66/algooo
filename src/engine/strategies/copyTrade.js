'use strict';

// Copy-trading. Mirrors the trades of tracked high-PnL wallets (from the
// leaderboard, or an explicit PM_COPY_WALLETS list). Each observed source trade
// is scaled down to PM_COPY_SCALE of its notional and bounded by the default
// order size, then queued as a signal on the same market/outcome/side.
//
// Unlike the price strategies this is event-driven: the bot feeds it source
// trades as they arrive rather than calling evaluate() on a price tick.
const config = require('../../config');

class CopyTradeStrategy {
  constructor() {
    this.name = 'copyTrade';
  }

  // Convert a single source trade into a signal (or null to skip).
  fromSourceTrade(srcTrade) {
    if (!srcTrade || !srcTrade.marketId) return null;
    const sizeUsd = Math.min(config.orderSizeUsd, srcTrade.sizeUsd * config.copyScale);
    if (sizeUsd < 1) return null;
    return {
      marketId: srcTrade.marketId,
      outcome: srcTrade.outcome,
      side: srcTrade.side === 'SELL' ? 'SELL' : 'BUY',
      sizeUsd,
      strategy: this.name,
      reason: `copy ${srcTrade.trader}: ${srcTrade.side} ${srcTrade.outcome} $${Math.round(srcTrade.sizeUsd)}`,
    };
  }
}

module.exports = { CopyTradeStrategy };
