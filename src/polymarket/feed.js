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
    const kind = config.forceMock ? 'mock' : 'auto';
    this.source = await this._buildSource(kind);
    await this._loadAll();
    log.info(`feed started (${this.source.kind}): ${this.markets.length} markets, copying ${this.copyWallets.length} wallets`);
    this.emit('status', { source: this.source.kind });
    this.emit('markets', this.markets);
    this._timer = setInterval(() => this._tick(), config.tickMs);
  }

  // Swap the data source at runtime: 'live', 'mock', or 'auto' (live, else mock).
  // Builds the new source first; only tears down the running feed once it's ready,
  // so a failed switch leaves the current source untouched.
  async switchSource(kind) {
    let source;
    try {
      source = await this._buildSource(kind);
    } catch (e) {
      return { ok: false, error: e.message, source: this.sourceKind };
    }
    this.stop();
    this.source = source;
    await this._loadAll();
    log.info(`source switched to ${this.source.kind}`);
    this.emit('status', { source: this.source.kind });
    this.emit('markets', this.markets);
    this._timer = setInterval(() => this._tick(), config.tickMs);
    return { ok: true, source: this.sourceKind };
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  marketById(id) {
    return this.markets.find((m) => m.id === id);
  }

  async _loadAll() {
    this.markets = await this.source.loadMarkets();
    this.leaderboard = await this.source.loadLeaderboard();
    this.copyWallets = this._resolveCopyWallets();
  }

  async _buildSource(kind) {
    if (kind === 'mock') return new MockSource();
    // 'live' or 'auto': probe the live APIs.
    try {
      const live = new LiveSource();
      await live.loadMarkets();
      log.info('connected to live Polymarket APIs');
      return live;
    } catch (e) {
      if (kind === 'live') throw new Error(`live data unreachable: ${e.message}`);
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
