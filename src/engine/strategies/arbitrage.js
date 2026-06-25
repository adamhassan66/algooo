'use strict';

// Cross-outcome arbitrage. In a binary market, owning 1 YES + 1 NO share always
// redeems for exactly $1 at resolution. So whenever YES_ask + NO_ask < 1, buying
// both legs locks in a risk-free profit of (1 - YES_ask - NO_ask) per pair.
// This is the canonical "only possible with bot speed" edge — windows are tiny.
const config = require('../../config');

class ArbitrageStrategy {
  constructor() {
    this.name = 'arbitrage';
  }

  // Returns an array of signals to execute this tick.
  evaluate(markets /*, portfolio */) {
    const signals = [];
    for (const m of markets) {
      if (!m.yesAsk || !m.noAsk) continue;
      const cost = m.yesAsk + m.noAsk;
      const edge = 1 - cost;
      if (edge < config.arbEdge) continue;

      // Split the configured order size across both legs by ratio so we buy an
      // equal number of YES/NO shares (the hedge that guarantees the payout).
      const half = config.orderSizeUsd / 2;
      const reason = `arb: YES ${m.yesAsk.toFixed(3)} + NO ${m.noAsk.toFixed(3)} = ${cost.toFixed(3)} (edge ${(edge * 100).toFixed(1)}%)`;
      signals.push(
        { marketId: m.id, outcome: 'YES', side: 'BUY', sizeUsd: half, strategy: this.name, reason },
        { marketId: m.id, outcome: 'NO', side: 'BUY', sizeUsd: half, strategy: this.name, reason }
      );
    }
    return signals;
  }
}

module.exports = { ArbitrageStrategy };
