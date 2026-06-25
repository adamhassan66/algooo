'use strict';

// Unified market-data feed. Prefers the live Polymarket source and transparently
// falls back to the mock source when the APIs are unreachable (or PM_FORCE_MOCK
// is set). Emits:
//   'markets'      (Market[])        on every tick
//   'sourceTrade'  (SourceTrade)     for each new tracked-wallet trade
//   'status'       ({source})        when the active source changes
const EventEmitter = require('events');
const config = require('../config');
const log = require('../util/logger');
const { MockSource } = require('./mock');
const { LiveSource } = require('./client');

class MarketFeed extends EventEmitter {
  constructor() {
    super();
    this.source = null;
    this.markets = [];
    this.leaderboard = [];
    this.copyWallets = [];
    this._timer = null;
  }

  get sourceKind() {
    return this.source ? this.source.kind : 'none';
  }

  async start() {
    this.source = await this._selectSource();
    this.emit('status', { source: this.source.kind });
    this.markets = await this.source.loadMarkets();
    this.leaderboard = await this.source.loadLeaderboard();
    this.copyWallets = this._resolveCopyWallets();
    log.info(`feed started (${this.source.kind}): ${this.markets.length} markets, copying ${this.copyWallets.length} wallets`);
    this.emit('markets', this.markets);
    this._timer = setInterval(() => this._tick(), config.tickMs);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  marketById(id) {
    return this.markets.find((m) => m.id === id);
  }

  async _selectSource() {
    if (config.forceMock) {
      log.info('PM_FORCE_MOCK set — using mock source');
      return new MockSource();
    }
    const live = new LiveSource();
    try {
      await live.loadMarkets();
      log.info('connected to live Polymarket APIs');
      return new LiveSource(); // fresh instance; markets are loaded again in start()
    } catch (e) {
      log.warn(`live Polymarket APIs unreachable (${e.message}); falling back to mock`);
      return new MockSource();
    }
  }

  _resolveCopyWallets() {
    if (config.copyWallets.length) return config.copyWallets.slice();
    return this.leaderboard.slice(0, config.copyTopN).map((t) => t.wallet);
  }

  async _tick() {
    try {
      this.source.tick(this.markets);
      this.emit('markets', this.markets);
      const trades = await this.source.pollSourceTrades(this.markets, this.copyWallets);
      for (const t of trades) this.emit('sourceTrade', t);
    } catch (e) {
      log.warn('feed tick error:', e.message);
    }
  }
}

module.exports = { MarketFeed };
