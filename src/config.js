'use strict';

// Loads a .env file (if present) into process.env, then exposes typed config.
// Intentionally dependency-free: a tiny parser is enough for KEY=VALUE lines.
const fs = require('fs');
const path = require('path');

(function loadDotEnv() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
})();

const num = (name, def) => {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const bool = (name, def) => {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return /^(1|true|yes|on)$/i.test(v);
};
const list = (name, def) => {
  const v = process.env[name];
  if (!v) return def;
  return v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
};

const config = {
  port: num('PORT', 3000),
  forceMock: bool('PM_FORCE_MOCK', false),

  // Optional PIN/passphrase gating the dashboard + API. When set, clients must
  // log in; when empty, the dashboard is open (fine for local/trusted networks).
  dashboardPin: process.env.PM_DASHBOARD_PIN || '',
  // Brute-force protection for the login endpoint.
  loginMaxAttempts: num('PM_LOGIN_MAX_ATTEMPTS', 5),
  loginLockoutMs: num('PM_LOGIN_LOCKOUT_MS', 60000),

  // paper account
  startingBalance: num('PM_STARTING_BALANCE', 10),
  slippageBps: num('PM_SLIPPAGE_BPS', 50),
  takerFeeBps: num('PM_TAKER_FEE_BPS', 0),
  tickMs: Math.max(250, num('PM_TICK_MS', 1000)),

  // risk — sized for a small, fast-scalping account by default
  orderSizeUsd: num('PM_ORDER_SIZE_USD', 2),
  maxPositionUsd: num('PM_MAX_POSITION_USD', 4),
  maxExposureUsd: num('PM_MAX_EXPOSURE_USD', 10),

  // strategies — defaults favour the genuine edges (spread capture + arb + copy).
  // Momentum is off by default: scalping noise just pays the spread and loses.
  strategies: {
    takeProfit: bool('PM_STRAT_TAKE_PROFIT', true),
    marketMaker: bool('PM_STRAT_MARKET_MAKER', true),
    arbitrage: bool('PM_STRAT_ARB', true),
    copyTrade: bool('PM_STRAT_COPY', true),
    momentum: bool('PM_STRAT_MOMENTUM', false),
  },
  arbEdge: num('PM_ARB_EDGE', 0.02),

  // market making: quote only when the spread is worth capturing
  mmMinSpread: num('PM_MM_MIN_SPREAD', 0.01), // 1¢ minimum spread to quote
  momentumWindowMs: num('PM_MOMENTUM_WINDOW_MS', 4000), // short window = fast signals
  momentumThreshold: num('PM_MOMENTUM_THRESHOLD', 0.02), // enter on smaller moves

  // fast scalping exits: take a small gain within seconds, keep losses tight so
  // it's small-win / small-loss (not small-win / occasional-blowup)
  takeProfitPct: num('PM_TAKE_PROFIT_PCT', 0.02), // sell when a position is +2%
  stopLossPct: num('PM_STOP_LOSS_PCT', 0.04), // cut at -4% (0 disables)

  // "ready to go live" gate: turns green only when paper performance is
  // consistently profitable across a meaningful sample.
  readiness: {
    minTrades: num('PM_READY_MIN_TRADES', 20), // need at least this many closed trades
    minWinRate: num('PM_READY_WIN_RATE', 0.55), // and this win rate
    window: num('PM_READY_WINDOW', 20), // recent closed trades that must also be net positive
  },

  // copy trading
  copyWallets: list('PM_COPY_WALLETS', []),
  copyTopN: num('PM_COPY_TOP_N', 3),
  copyScale: num('PM_COPY_SCALE', 0.02),

  // LIVE TRADING (real money) — disabled by default. Requires the optional
  // deps (@polymarket/clob-client, ethers) and a wallet key. See README.
  live: {
    enabled: bool('PM_LIVE_TRADING', false),
    privateKey: process.env.PM_PRIVATE_KEY || '',
    funderAddress: process.env.PM_FUNDER_ADDRESS || '',
    // 0 = EOA, 1 = Polymarket proxy, 2 = Polymarket Gnosis safe
    signatureType: num('PM_SIGNATURE_TYPE', 0),
    host: process.env.PM_CLOB_HOST || 'https://clob.polymarket.com',
    chainId: num('PM_CHAIN_ID', 137),
    // how often to reconcile the dashboard against real on-chain state
    syncIntervalMs: num('PM_LIVE_SYNC_MS', 10000),
  },

  publicDir: path.join(__dirname, '..', 'public'),

  // Polymarket public API endpoints (used when reachable)
  endpoints: {
    gamma: 'https://gamma-api.polymarket.com',
    clob: 'https://clob.polymarket.com',
    data: 'https://data-api.polymarket.com',
    leaderboard: 'https://lb-api.polymarket.com',
  },
};

module.exports = config;
