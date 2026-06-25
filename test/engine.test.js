'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { Portfolio } = require('../src/engine/portfolio');
const { ArbitrageStrategy } = require('../src/engine/strategies/arbitrage');
const { TakeProfitStrategy } = require('../src/engine/strategies/takeProfit');

const market = (over = {}) => ({
  id: 'm1', question: 'Q?', yesTokenId: 'm1_YES', noTokenId: 'm1_NO',
  yesBid: 0.49, yesAsk: 0.51, noBid: 0.49, noAsk: 0.51, ...over,
});

test('BUY then SELL realizes PnL and frees cash', () => {
  const p = new Portfolio(1000);
  const m = market();
  p.applyFill({ market: m, outcome: 'YES', tokenId: 'm1_YES', side: 'BUY', shares: 100, price: 0.5 });
  assert.equal(p.cash, 950);
  assert.equal(p.position('m1', 'YES').shares, 100);

  // sell at a higher price
  p.applyFill({ market: m, outcome: 'YES', tokenId: 'm1_YES', side: 'SELL', shares: 100, price: 0.6 });
  assert.ok(!p.position('m1', 'YES'), 'position closed');
  assert.ok(Math.abs(p.realizedPnl - 10) < 1e-9, 'realized +$10');
});

test('cannot BUY without cash', () => {
  const p = new Portfolio(10);
  assert.throws(() => p.applyFill({ market: market(), outcome: 'YES', tokenId: 'm1_YES', side: 'BUY', shares: 100, price: 0.5 }));
});

test('valuation marks positions to the bid', () => {
  const p = new Portfolio(1000);
  const m = market({ yesBid: 0.7 });
  p.applyFill({ market: m, outcome: 'YES', tokenId: 'm1_YES', side: 'BUY', shares: 100, price: 0.5 });
  const v = p.valuation(new Map([['m1', m]]));
  assert.ok(Math.abs(v.unrealizedPnl - 20) < 1e-9, 'unrealized = 100*(0.7-0.5)');
});

test('loadSnapshot reconciles cash + positions from on-chain truth', () => {
  const p = new Portfolio(10000);
  // a stale local position that should be replaced by the on-chain snapshot
  p.applyFill({ market: market(), outcome: 'YES', tokenId: 'm1_YES', side: 'BUY', shares: 10, price: 0.5 });

  p.loadSnapshot({
    cash: 250.5,
    positions: [
      { marketId: 'cond1', outcome: 'NO', tokenId: 't1', shares: 40, avgPrice: 0.3, curPrice: 0.45, question: 'Real market?' },
      { marketId: 'cond2', outcome: 'YES', tokenId: 't2', shares: 0, avgPrice: 0.6 }, // zero size dropped
    ],
  });

  assert.equal(p.cash, 250.5, 'cash replaced by real balance');
  assert.equal(p.positions.size, 1, 'zero-size position dropped, stale local cleared');
  // marks against curPrice when the market is not in the feed
  const v = p.valuation(new Map());
  assert.ok(Math.abs(v.positionsValue - 40 * 0.45) < 1e-9, 'valued at curPrice');
  assert.ok(Math.abs(v.unrealizedPnl - 40 * (0.45 - 0.3)) < 1e-9, 'unrealized from on-chain avg');
  assert.equal(v.positions[0].question, 'Real market?', 'carries title for off-feed markets');
});

test('take-profit sells a winner and holds a flat position', () => {
  const strat = new TakeProfitStrategy();
  const p = new Portfolio(10);
  const m = market();
  // buy YES at 0.50, mark moves so bid = 0.60 -> +20% gain (>= 5% target)
  p.applyFill({ market: m, outcome: 'YES', tokenId: 'm1_YES', side: 'BUY', shares: 4, price: 0.5 });
  const winner = market({ yesBid: 0.6 });
  const sells = strat.evaluate([winner], p);
  assert.equal(sells.length, 1);
  assert.equal(sells[0].side, 'SELL');
  assert.match(sells[0].reason, /take-profit/);

  // a barely-moved position is left alone
  assert.equal(strat.evaluate([market({ yesBid: 0.51 })], p).length, 0);
});

test('arbitrage fires only when YES_ask + NO_ask < 1 - edge', () => {
  const strat = new ArbitrageStrategy();
  // no arb: 0.51 + 0.51 = 1.02
  assert.equal(strat.evaluate([market()]).length, 0);
  // arb: 0.45 + 0.45 = 0.90 -> edge 0.10
  const sigs = strat.evaluate([market({ yesAsk: 0.45, noAsk: 0.45 })]);
  assert.equal(sigs.length, 2, 'buys both legs');
  assert.deepEqual(sigs.map((s) => s.outcome).sort(), ['NO', 'YES']);
});
