'use strict';

// The trading bot: wires the market feed to the paper portfolio via the
// strategies and executor. On each price tick it runs the enabled price
// strategies; tracked-wallet trades drive the copy strategy as they arrive.
// After each tick it emits an 'update' with a full dashboard snapshot.
const EventEmitter = require('events');
const config = require('../config');
const log = require('../util/logger');
const { Portfolio } = require('./portfolio');
const { Executor } = require('./executor');
const { LiveExecutor } = require('./liveExecutor');
const { ArbitrageStrategy } = require('./strategies/arbitrage');
const { MomentumStrategy } = require('./strategies/momentum');
const { CopyTradeStrategy } = require('./strategies/copyTrade');

class TradingBot extends EventEmitter {
  constructor(feed) {
    super();
    this.feed = feed;
    this.portfolio = new Portfolio(config.startingBalance);
    this.paperExecutor = new Executor(this.portfolio);
    this.executor = this.paperExecutor; // swapped to live in init() when armed
    this.mode = 'paper'; // 'paper' | 'live'
    this.liveAddress = null;
    this.running = false;
    this.enabled = { ...config.strategies };
    this.signalsLog = []; // recent signals (executed or rejected), newest first

    this.arb = new ArbitrageStrategy();
    this.momentum = new MomentumStrategy();
    this.copy = new CopyTradeStrategy();

    feed.on('markets', (markets) => this._onMarkets(markets));
    feed.on('sourceTrade', (t) => this._onSourceTrade(t));
  }

  // Arm live trading if configured; otherwise stay on the paper executor.
  // Safe by default: any failure to initialize live trading leaves the bot in
  // paper mode rather than trading real funds in an unknown state.
  async init() {
    if (!config.live.enabled) return;
    try {
      const live = new LiveExecutor(this.portfolio);
      await live.init();
      this.executor = live;
      this.mode = 'live';
      this.liveAddress = live.address;
    } catch (e) {
      log.error(`LIVE TRADING NOT ARMED (${e.message}) — staying in paper mode`);
      this.mode = 'paper';
      this.executor = this.paperExecutor;
    }
  }

  start() { this.running = true; log.info(`bot started (${this.mode})`); }
  stop() { this.running = false; log.info('bot stopped'); }

  setStrategy(name, on) {
    if (name in this.enabled) this.enabled[name] = !!on;
  }

  // Reset the local (display) account. In live mode this only resets the
  // dashboard mirror — it does not touch real on-chain positions.
  reset() {
    this.portfolio = new Portfolio(config.startingBalance);
    this.paperExecutor = new Executor(this.portfolio);
    if (this.mode === 'live' && this.executor && this.executor.ready) {
      this.executor.portfolio = this.portfolio; // keep live client, repoint mirror
    } else {
      this.executor = this.paperExecutor;
    }
    this.signalsLog = [];
    this.momentum.history.clear();
    log.info('account reset');
  }

  // Liquidate every open position at the current bid.
  async flatten() {
    const markets = this._marketsById();
    for (const p of [...this.portfolio.positions.values()]) {
      const m = markets.get(p.marketId);
      if (!m) continue;
      await this.executor.execute(
        { marketId: p.marketId, outcome: p.outcome, side: 'SELL', sizeUsd: p.shares * (p.outcome === 'YES' ? m.yesBid : m.noBid), strategy: 'manual', reason: 'flatten' },
        m
      );
    }
  }

  // Manual order from the dashboard.
  async manualOrder({ marketId, outcome, side, sizeUsd }) {
    const market = this.feed.marketById(marketId);
    const res = await this.executor.execute(
      { marketId, outcome, side, sizeUsd: Number(sizeUsd), strategy: 'manual', reason: 'manual order' },
      market
    );
    this._record({ marketId, outcome, side, strategy: 'manual', reason: 'manual order' }, res);
    this.emit('update', this.snapshot());
    return res;
  }

  _marketsById() {
    return new Map(this.feed.markets.map((m) => [m.id, m]));
  }

  async _onMarkets(markets) {
    if (this.running) {
      const signals = [];
      if (this.enabled.arbitrage) signals.push(...this.arb.evaluate(markets, this.portfolio));
      if (this.enabled.momentum) signals.push(...this.momentum.evaluate(markets, this.portfolio));
      for (const s of signals) await this._run(s);
    }
    this.emit('update', this.snapshot());
  }

  async _onSourceTrade(srcTrade) {
    this.emit('sourceTrade', srcTrade);
    if (!this.running || !this.enabled.copyTrade) return;
    const signal = this.copy.fromSourceTrade(srcTrade);
    if (signal) await this._run(signal);
  }

  async _run(signal) {
    const market = this.feed.marketById(signal.marketId);
    const res = await this.executor.execute(signal, market);
    this._record(signal, res);
  }

  _record(signal, res) {
    this.signalsLog.unshift({
      ts: Date.now(),
      strategy: signal.strategy,
      marketId: signal.marketId,
      outcome: signal.outcome,
      side: signal.side,
      reason: signal.reason,
      status: res.ok ? 'filled' : 'rejected',
      detail: res.ok ? `${res.trade.shares.toFixed(1)} @ ${res.trade.price.toFixed(3)}` : res.error,
    });
    if (this.signalsLog.length > 200) this.signalsLog.length = 200;
  }

  snapshot() {
    const marketsById = this._marketsById();
    const val = this.portfolio.valuation(marketsById);
    return {
      ts: Date.now(),
      running: this.running,
      mode: this.mode,
      liveAddress: this.liveAddress,
      source: this.feed.sourceKind,
      enabled: this.enabled,
      account: {
        startingBalance: this.portfolio.startingBalance,
        cash: val.cash,
        equity: val.equity,
        positionsValue: val.positionsValue,
        realizedPnl: val.realizedPnl,
        unrealizedPnl: val.unrealizedPnl,
        totalPnl: val.totalPnl,
        returnPct: val.returnPct,
        exposure: val.exposure,
      },
      positions: val.positions,
      trades: this.portfolio.trades.slice(0, 30),
      signals: this.signalsLog.slice(0, 30),
      markets: this.feed.markets
        .map((m) => ({
          id: m.id, question: m.question,
          yesBid: m.yesBid, yesAsk: m.yesAsk, noBid: m.noBid, noAsk: m.noAsk,
          arbEdge: 1 - (m.yesAsk + m.noAsk),
          volume24h: m.volume24h,
        }))
        .sort((a, b) => b.arbEdge - a.arbEdge),
      leaderboard: this.feed.leaderboard,
      copyWallets: this.feed.copyWallets,
    };
  }
}

module.exports = { TradingBot };
