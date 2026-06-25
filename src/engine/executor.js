'use strict';

// Simulated order execution. Converts a strategy signal into a fill against the
// current book, modelling taker slippage and fees, then applies it to the
// portfolio. Enforces risk limits before committing.
const config = require('../config');
const log = require('../util/logger');

function quote(market, outcome, side) {
  // BUY crosses the ask, SELL hits the bid.
  if (side === 'BUY') return outcome === 'YES' ? market.yesAsk : market.noAsk;
  return outcome === 'YES' ? market.yesBid : market.noBid;
}

class Executor {
  constructor(portfolio) {
    this.portfolio = portfolio;
    this.rejected = 0;
  }

  // signal: { marketId, outcome, side, sizeUsd, strategy, reason, maker?, price? }
  // Maker signals (market-making) fill at their own resting price with no
  // slippage — that's the point: you earn the spread instead of paying it.
  execute(signal, market) {
    if (!market) return { ok: false, error: 'unknown market' };

    let price;
    if (signal.maker && signal.price > 0 && signal.price < 1) {
      price = signal.price;
    } else {
      const base = quote(market, signal.outcome, signal.side);
      if (!base || base <= 0 || base >= 1) return { ok: false, error: 'no quote' };
      // Slippage worsens the price in the direction of the trade.
      const slip = config.slippageBps / 10000;
      price = signal.side === 'BUY'
        ? Math.min(0.99, base * (1 + slip))
        : Math.max(0.01, base * (1 - slip));
    }

    const tokenId = signal.outcome === 'YES' ? market.yesTokenId : market.noTokenId;

    if (signal.side === 'BUY') {
      const risk = this._checkRisk(market.id, signal.outcome, signal.sizeUsd);
      if (!risk.ok) {
        this.rejected++;
        return { ok: false, error: risk.error };
      }
    }

    const sizeUsd = signal.side === 'BUY'
      ? Math.min(signal.sizeUsd, this.portfolio.cash)
      : signal.sizeUsd;
    if (sizeUsd <= 1) return { ok: false, error: 'size too small / no cash' };

    let shares = sizeUsd / price;
    if (signal.side === 'SELL') {
      const pos = this.portfolio.position(market.id, signal.outcome);
      if (!pos) return { ok: false, error: 'no position' };
      shares = Math.min(shares, pos.shares);
    }
    const fee = shares * price * (config.takerFeeBps / 10000);

    try {
      const trade = this.portfolio.applyFill({
        market, outcome: signal.outcome, tokenId,
        side: signal.side, shares, price, fee,
        strategy: signal.strategy, reason: signal.reason,
      });
      log.debug(`fill ${signal.side} ${signal.outcome} ${market.id} ${shares.toFixed(1)}@${price.toFixed(3)} (${signal.strategy})`);
      return { ok: true, trade };
    } catch (e) {
      this.rejected++;
      return { ok: false, error: e.message };
    }
  }

  _checkRisk(marketId, outcome, sizeUsd) {
    const pos = this.portfolio.position(marketId, outcome);
    const positionUsd = (pos ? pos.shares * pos.avgPrice : 0) + sizeUsd;
    if (positionUsd > config.maxPositionUsd) {
      return { ok: false, error: `max position ($${config.maxPositionUsd}) exceeded` };
    }
    if (this.portfolio.exposure() + sizeUsd > config.maxExposureUsd) {
      return { ok: false, error: `max exposure ($${config.maxExposureUsd}) exceeded` };
    }
    return { ok: true };
  }
}

module.exports = { Executor };
