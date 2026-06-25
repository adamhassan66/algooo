'use strict';

// LIVE order execution against Polymarket's CLOB. This is the real-money path.
// It is OFF by default and only used when PM_LIVE_TRADING=true AND a wallet key
// is configured AND the optional deps are installed. Otherwise the bot stays on
// the simulated (paper) executor.
//
// Dependencies are loaded lazily so the paper bot keeps its zero-dependency,
// runs-anywhere property:
//     npm install @polymarket/clob-client ethers
//
// Same interface as the paper Executor: async execute(signal, market) -> {ok, trade}.
const config = require('../config');
const log = require('../util/logger');

// Drop undefined/empty fields so an override only replaces values it actually
// provides (e.g. an omitted signatureType keeps the configured default).
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

function loadDeps() {
  // Throws a clear message if the optional packages aren't installed.
  let ethers, clob;
  try {
    ethers = require('ethers');
  } catch {
    throw new Error('ethers not installed — run: npm install ethers @polymarket/clob-client');
  }
  try {
    clob = require('@polymarket/clob-client');
  } catch {
    throw new Error('@polymarket/clob-client not installed — run: npm install @polymarket/clob-client ethers');
  }
  return { ethers, clob };
}

class LiveExecutor {
  // `override` lets the dashboard supply credentials at runtime
  // ({ privateKey, funderAddress, signatureType }); anything omitted falls back
  // to the PM_* env config.
  constructor(portfolio, override = {}) {
    this.portfolio = portfolio; // local mirror for the dashboard
    this.override = override;
    this.client = null;
    this.ready = false;
    this.address = null;
  }

  // Authenticate the wallet and derive CLOB API credentials. Throws on any
  // misconfiguration so the caller can refuse to arm live trading.
  async init() {
    const live = { ...config.live, ...clean(this.override) };
    if (!live.privateKey) throw new Error('no private key provided');

    const { ethers, clob } = loadDeps();
    const { ClobClient } = clob;

    const pk = live.privateKey.startsWith('0x') ? live.privateKey : `0x${live.privateKey}`;
    const signer = new ethers.Wallet(pk);
    this.address = await signer.getAddress();

    // First client (signer only) is used to obtain API credentials.
    const bootstrap = new ClobClient(live.host, live.chainId, signer);
    const creds = await bootstrap.createOrDeriveApiKey();

    // Re-create with creds + signature type + funder (proxy/safe) for trading.
    this.client = new ClobClient(
      live.host,
      live.chainId,
      signer,
      creds,
      live.signatureType,
      live.funderAddress || undefined
    );
    this.Side = clob.Side;
    this.OrderType = clob.OrderType;
    this.AssetType = clob.AssetType;
    this.account = live.funderAddress || this.address; // address that holds funds/positions
    this.lastSync = null;
    this.override = null; // don't retain the supplied key beyond wallet creation
    this.ready = true;
    log.warn(`LIVE TRADING ARMED — wallet ${this.address} (sigType ${live.signatureType}, funder ${live.funderAddress || 'self'})`);
  }

  // Reconcile the dashboard mirror with real on-chain state: USDC balance from
  // the CLOB and open positions from the Data API. Best-effort — on failure the
  // last known mirror is left untouched. Returns a small status object.
  async syncFromChain() {
    if (!this.ready) return { ok: false, error: 'live executor not initialized' };
    try {
      const [positions, cash] = await Promise.all([this._fetchPositions(), this._fetchCash()]);
      this.portfolio.loadSnapshot({ cash, positions });
      this.lastSync = Date.now();
      return { ok: true, positions: positions.length, cash };
    } catch (e) {
      log.warn('on-chain sync failed:', e.message);
      return { ok: false, error: e.message };
    }
  }

  async _fetchCash() {
    try {
      const ba = await this.client.getBalanceAllowance({ asset_type: this.AssetType.COLLATERAL });
      const bal = Number(ba && ba.balance);
      return Number.isFinite(bal) ? bal / 1e6 : undefined; // USDC has 6 decimals
    } catch (e) {
      log.warn('balance fetch failed:', e.message);
      return undefined; // leave mirror cash unchanged
    }
  }

  async _fetchPositions() {
    const url = `${config.endpoints.data}/positions?user=${this.account}&sizeThreshold=0.01&limit=500`;
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`positions HTTP ${res.status}`);
    const raw = await res.json();
    return (Array.isArray(raw) ? raw : []).map((p) => ({
      marketId: String(p.conditionId),
      outcome: String(p.outcome || '').toUpperCase() === 'NO' ? 'NO' : 'YES',
      tokenId: p.asset,
      shares: Number(p.size) || 0,
      avgPrice: Number(p.avgPrice) || 0,
      curPrice: Number.isFinite(Number(p.curPrice)) ? Number(p.curPrice) : undefined,
      question: p.title,
    }));
  }

  quote(market, outcome, side) {
    if (side === 'BUY') return outcome === 'YES' ? market.yesAsk : market.noAsk;
    return outcome === 'YES' ? market.yesBid : market.noBid;
  }

  // Submit a marketable order, then mirror the fill into the local portfolio so
  // the dashboard reflects it. Real position reconciliation against on-chain
  // balances is intentionally left as a follow-up (see README).
  async execute(signal, market) {
    if (!this.ready) return { ok: false, error: 'live executor not initialized' };
    if (!market) return { ok: false, error: 'unknown market' };

    const tokenID = signal.outcome === 'YES' ? market.yesTokenId : market.noTokenId;
    const px = this.quote(market, signal.outcome, signal.side);
    if (!px || px <= 0 || px >= 1) return { ok: false, error: 'no quote' };

    // UserMarketOrder.amount: BUY = USDC to spend, SELL = shares to sell.
    let amount;
    if (signal.side === 'BUY') {
      amount = signal.sizeUsd;
    } else {
      const pos = this.portfolio.position(market.id, signal.outcome);
      if (!pos || pos.shares <= 0) return { ok: false, error: 'no position to sell' };
      amount = Math.min(signal.sizeUsd / px, pos.shares);
    }
    if (amount <= 0) return { ok: false, error: 'size too small' };

    try {
      const order = await this.client.createMarketOrder({
        tokenID,
        amount,
        side: signal.side === 'BUY' ? this.Side.BUY : this.Side.SELL,
        price: px, // protective limit for the marketable order
      });
      const resp = await this.client.postOrder(order, this.OrderType.FOK);
      if (resp && resp.success === false) {
        return { ok: false, error: resp.errorMsg || 'order rejected by CLOB' };
      }

      // Mirror into the local portfolio for display.
      const shares = signal.side === 'BUY' ? amount / px : amount;
      const trade = this.portfolio.applyFill({
        market, outcome: signal.outcome, tokenId: tokenID,
        side: signal.side, shares, price: px, fee: 0,
        strategy: signal.strategy, reason: signal.reason, force: true,
      });
      trade.live = true;
      trade.orderId = resp && (resp.orderID || resp.orderId);
      log.warn(`LIVE ${signal.side} ${signal.outcome} ${market.id} ${shares.toFixed(2)}@${px.toFixed(3)} order=${trade.orderId || 'n/a'}`);
      return { ok: true, trade };
    } catch (e) {
      log.error('live order failed:', e.message);
      return { ok: false, error: e.message };
    }
  }
}

module.exports = { LiveExecutor };
