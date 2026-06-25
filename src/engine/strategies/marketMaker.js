'use strict';

// Market making — the realistic "small consistent gains" engine. Instead of
// paying the spread as a taker, it posts passive limit orders and earns it:
// buy at the bid on a dip, sell at the ask on a bounce. Each completed round
// trip captures ~the spread.
//
// This is not free money: if the price trends against an open inventory we sit
// on a loser (adverse selection). The strategy only sells at a profit; runaway
// inventory is cut by the stop-loss in takeProfit.js. So the honest picture is
// "wins the spread in choppy markets, bleeds in strong trends" — which is why
// the readiness gate, on real data, is the final arbiter.
//
// Fills are modelled off the mid moving through our resting quote: a down-tick
// fills our bid, an up-tick (while long, above our cost) lifts our ask.
const config = require('../../config');

class MarketMakerStrategy {
  constructor() {
    this.name = 'marketMaker';
    this.prevMid = new Map(); // marketId -> last mid
  }

  evaluate(markets, portfolio) {
    const signals = [];
    for (const m of markets) {
      if (!m.yesBid || !m.yesAsk) continue;
      const mid = (m.yesBid + m.yesAsk) / 2;
      const prev = this.prevMid.get(m.id);
      this.prevMid.set(m.id, mid);
      if (prev === undefined) continue;

      const spread = m.yesAsk - m.yesBid;
      if (spread < config.mmMinSpread) continue; // too tight to bother

      const pos = portfolio.position(m.id, 'YES');
      const held = pos ? pos.shares : 0;

      if (held <= 0) {
        // No inventory: rest a bid. A down-tick means it gets hit → buy cheap.
        if (mid < prev) {
          signals.push({
            marketId: m.id, outcome: 'YES', side: 'BUY', maker: true, price: m.yesBid,
            sizeUsd: config.orderSizeUsd, strategy: this.name,
            reason: `MM bid ${(m.yesBid * 100).toFixed(1)}¢ (capture ${(spread * 100).toFixed(1)}¢)`,
          });
        }
      } else if (mid > prev && m.yesAsk > pos.avgPrice) {
        // Long inventory: rest an ask. An up-tick above our cost lifts it → sell rich.
        signals.push({
          marketId: m.id, outcome: 'YES', side: 'SELL', maker: true, price: m.yesAsk,
          sizeUsd: held * m.yesAsk * 1.05, strategy: this.name,
          reason: `MM ask ${(m.yesAsk * 100).toFixed(1)}¢ (+${((m.yesAsk - pos.avgPrice) * 100).toFixed(1)}¢)`,
        });
      }
    }
    return signals;
  }
}

module.exports = { MarketMakerStrategy };
