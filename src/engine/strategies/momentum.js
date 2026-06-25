'use strict';

// Short-window momentum. Tracks each market's YES midpoint over a rolling window
// and trades the breakout: a fast upward move buys YES, a fast downward move
// buys NO (binary markets have no shorting, so downside is expressed via NO).
// One position per market per direction at a time to avoid stacking.
const config = require('../../config');

function mid(market, outcome) {
  return outcome === 'YES'
    ? (market.yesBid + market.yesAsk) / 2
    : (market.noBid + market.noAsk) / 2;
}

class MomentumStrategy {
  constructor() {
    this.name = 'momentum';
    this.history = new Map(); // marketId -> [{ t, p }]
  }

  evaluate(markets, portfolio) {
    const now = Date.now();
    const signals = [];
    for (const m of markets) {
      const p = mid(m, 'YES');
      if (!p) continue;
      const hist = this.history.get(m.id) || [];
      hist.push({ t: now, p });
      while (hist.length && now - hist[0].t > config.momentumWindowMs) hist.shift();
      this.history.set(m.id, hist);
      if (hist.length < 2) continue;

      const change = p - hist[0].p;
      if (Math.abs(change) < config.momentumThreshold) continue;

      const outcome = change > 0 ? 'YES' : 'NO';
      // Skip if we already hold this directional position.
      if (portfolio.position(m.id, outcome)) continue;

      signals.push({
        marketId: m.id,
        outcome,
        side: 'BUY',
        sizeUsd: config.orderSizeUsd,
        strategy: this.name,
        reason: `momentum: YES mid ${change > 0 ? '+' : ''}${(change * 100).toFixed(1)}% in ${(config.momentumWindowMs / 1000)}s`,
      });
    }
    return signals;
  }
}

module.exports = { MomentumStrategy };
