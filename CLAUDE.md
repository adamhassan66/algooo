# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PolyBot — a **Polymarket paper-trading bot**. It runs automated strategies against
Polymarket prices using a virtual balance (no wallet keys, no real funds) and
serves a mobile-first live dashboard you open from a phone browser. The whole
thing is **zero-dependency Node.js** (built-in `http` + Server-Sent Events); there
is no build step and nothing to `npm install`.

## Commands

```bash
npm start          # run the bot + dashboard on http://localhost:3000
npm run dev        # same, with --watch auto-reload
npm test           # node --test (unit tests in test/)
node --test test/engine.test.js   # run a single test file
```

Configure via a `.env` file (auto-loaded by `src/config.js`); see `.env.example`
for every key. Useful overrides: `PM_FORCE_MOCK=true` to force the mock feed,
`PM_TICK_MS` to speed up/slow down evaluation, `PM_STRAT_*` to toggle strategies.

## Architecture

Data flows in one direction: **feed → bot → portfolio → snapshot → dashboard**.

- **Market feed** (`src/polymarket/feed.js`) — an `EventEmitter` that, on each
  `tickMs` interval, emits a `markets` snapshot and `sourceTrade` events. It picks
  a source at startup and **auto-falls back to mock**:
  - `client.js` (`LiveSource`) — read-only calls to Polymarket's public REST APIs
    (Gamma markets, CLOB order books, leaderboard, wallet activity). Never signs or
    submits orders.
  - `mock.js` (`MockSource`) — random-walking binary markets, injected arbitrage
    windows, a fake leaderboard, and simulated tracked-wallet trades.
  Both implement the **same interface** (`loadMarkets`, `tick`, `loadLeaderboard`,
  `pollSourceTrades`) so the rest of the system is source-agnostic. In environments
  without network access to Polymarket, the live source throws on startup and the
  feed transparently uses mock — this is the normal local-dev path.

- **Bot** (`src/engine/bot.js`) — orchestrator. Subscribes to the feed; on each
  `markets` tick runs the enabled **price strategies**, and on each `sourceTrade`
  runs the **copy strategy**. Routes every resulting signal through the executor,
  logs it, and emits an `update` carrying a full `snapshot()` (account, positions,
  trades, signals, markets, leaderboard) — that snapshot is the single contract
  with the frontend.

- **Strategies** (`src/engine/strategies/`) — each returns/produces *signals*, never
  touching the portfolio directly:
  - `takeProfit.js` — the exit/scalping rule: marks open positions to the bid and
    SELLs to close on `takeProfitPct` gain or `stopLossPct` loss. Runs first each
    tick so gains are realized and capital recycled before new entries. This is what
    makes the small-balance "fast gains" preset work.
  - `arbitrage.js` — buys both YES+NO when `yesAsk + noAsk < 1 - arbEdge`
    (guaranteed $1 redemption = risk-free edge; the speed play). A matched pair is
    valued at $1 in `portfolio.valuation()`, so the locked edge shows immediately
    instead of looking like a loss until resolution.
  - `marketMaker.js` — posts passive maker quotes (buy bid on a dip, sell ask on a
    bounce) to **earn** the spread instead of paying it; the realistic "consistent
    small gains" engine. Maker fills go through the executor with `maker:true` +
    `price` (no slippage). Honest risk: holds losing inventory in trends, cut by the
    take-profit stop-loss. **This is why the bot wins** — taker momentum just pays the
    spread, so `momentum.js` is OFF by default.
  - `momentum.js` — rolling YES-midpoint window; fast up-move buys YES, fast
    down-move buys NO. Off by default (negative-EV on choppy markets).
  - `copyTrade.js` — event-driven (`fromSourceTrade`), mirrors tracked-wallet
    trades scaled by `copyScale`.

  Defaults are tuned for a small, fast-scalping account: `$10` start, `$2` orders,
  `$10` max exposure, take-profit at +5%, stop-loss at -20%. The mock feed adds mild
  per-market drift so momentum/exits behave like real trending markets, not a pure
  random walk.

- **Executor** (`src/engine/executor.js`) — turns a signal into a simulated fill:
  crosses the book, applies `slippageBps`/`takerFeeBps`, enforces risk limits
  (`maxPositionUsd`, `maxExposureUsd`), then calls `portfolio.applyFill`.

- **LiveExecutor** (`src/engine/liveExecutor.js`) — the **real-money** path, same
  `async execute(signal, market)` interface as the paper executor. Off unless
  `PM_LIVE_TRADING=true` with a wallet key. `bot.init()` tries to arm it and, on any
  failure, falls back to paper (safe default). It lazy-loads the optional deps
  (`@polymarket/clob-client` + **ethers v5** — v6 is incompatible, see below),
  derives CLOB API creds from the signer, and submits FOK marketable orders, then
  mirrors the fill into the local portfolio for the dashboard. In live mode it also
  **reconciles** the portfolio against on-chain truth via `syncFromChain()` (USDC
  balance from the CLOB + positions from the Data API) — on arm, throttled by
  `live.syncIntervalMs`, and forced after each fill. `Portfolio.loadSnapshot()` swaps
  in that truth; the bot rebases `startingBalance` to the first synced equity so PnL
  tracks the session. All sync is best-effort: a failure leaves the last good mirror.

- **Portfolio** (`src/engine/portfolio.js`) — the virtual account: cash, positions
  keyed by `marketId:outcome`, realized PnL, and mark-to-market `valuation()`. Each
  SELL also pushes a `{ts, pnl}` to `closedTrades` for win-rate/readiness stats.

- **Readiness gate** (`bot.performance()`) — summarizes closed-trade win rate and
  realized PnL and emits `readiness: insufficient|not_ready|ready`. The intended
  workflow is paper-trading against the **live data source** (real prices, mock money)
  until the dashboard banner turns green, then connecting a wallet. Thresholds in
  `config.readiness` (`minTrades`/`minWinRate`/`window`). It only goes green on
  genuinely profitable configs — losing scalps stay amber.

- **Server** (`src/server.js`) — serves `public/`, a small JSON REST API
  (`/api/state`, `/api/history` for the chart series, `/api/config`, `/api/control`,
  `/api/strategies`, `/api/order`, `/api/source` to swap data source,
  `/api/connect`/`/api/disconnect` to arm/disarm a live wallet at runtime), and the
  SSE stream `/api/stream`. Trading is **always
  server-side**; the dashboard is view + control only. The connect endpoint never
  echoes the key, and the key is held only in memory (not persisted, not in snapshots).
  When `PM_DASHBOARD_PIN` is set, all `/api/*` except `/api/auth` and `/api/login`
  require a valid session cookie — a stateless HMAC token (random per-process secret,
  so restarts log everyone out); the frontend shows a lock screen until `/api/login`
  succeeds. `/api/login` is rate-limited per IP (`loginMaxAttempts`/`loginLockoutMs`,
  in-memory) and `/api/logout` clears the session. No PIN ⇒ open (local/trusted use).

- **Dashboard** (`public/`) — one `EventSource('/api/stream')` re-renders the whole
  UI from each snapshot. Controls POST to the REST API. No framework, no bundler. The
  live chart is hand-drawn inline SVG (no chart lib): seeded once from `/api/history`,
  then each snapshot appends a point; toggles between equity and realized-PnL series.

## Conventions & constraints worth knowing

- **No shorting.** Polymarket binary markets have none, and the model mirrors that:
  `BUY` opens/increases a position; `SELL` only reduces a position you already hold.
  To express downside, strategies **buy the opposite outcome** (buy NO instead of
  shorting YES) — see `momentum.js`.
- **The snapshot is the API contract.** When you add a field the UI needs, add it to
  `bot.snapshot()`; the frontend reads only from there.
- **Keep the paper path dependency-free.** Prefer Node built-ins and SSE over adding
  packages; the "runs anywhere with no install" property is intentional. The only
  packages are `optionalDependencies` for live trading, lazy-loaded so a missing
  install never breaks paper mode.
- **ethers v5, not v6.** `@polymarket/clob-client` detects ethers signers via
  `_signTypedData` (v5). Ethers v6 renamed it to `signTypedData`, which the client
  misreads as a viem wallet and rejects ("wallet client is missing account address").
- **Live execution is async and gated.** The bot's execute path (`_run`, `_onMarkets`,
  `manualOrder`, `flatten`) is `await`-based so paper (sync) and live (async) share it.
  Live mode never auto-starts; the server only auto-starts in paper mode.
- **Source and wallet are switchable at runtime.** `feed.switchSource('live'|'mock'|
  'auto')` builds the new source before tearing down the old one (a failed switch keeps
  the current feed). `bot.connectLive(creds)`/`disconnectLive()` swap the executor live;
  `LiveExecutor(portfolio, override)` takes runtime creds that fall back to PM_* env.
- Prices are probabilities in `(0,1)`; the UI displays them as cents (`¢`).
- CommonJS throughout (`require`/`module.exports`), `'use strict'` at the top of each
  module.
