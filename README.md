# PolyBot

A **Polymarket paper-trading bot** with automated edge strategies, copy-trading,
and a sleek, mobile-first live dashboard you open from your phone.

It trades a **virtual balance against live Polymarket prices** — no wallet keys, no
real funds. It's built to surface the kind of edges that are only catchable at bot
speed, and to mirror high-PnL traders. Start in simulation; when you're confident in
a strategy, you have a clean, tested engine to build on.

> ⚠️ Simulation only. PolyBot never signs transactions or places real orders. It is a
> research/learning tool. Trading prediction markets carries risk; nothing here is
> financial advice.

## Quick start

```bash
npm start
```

Then open **http://localhost:3000** — on your iPhone, use your computer's LAN address
(e.g. `http://192.168.1.x:3000`) and add it to the Home Screen for a full-screen,
app-like experience.

No dependencies to install: PolyBot is pure Node.js (>=20) using only built-in
modules. Run the tests with `npm test`.

## How it works

- **Live data with automatic fallback.** It connects to Polymarket's public APIs for
  markets, order books, the leaderboard, and wallet activity. If those APIs aren't
  reachable from where you're running it, it transparently switches to a realistic
  **mock market simulator** so everything still runs end-to-end.
- **Strategies** (toggle each from the dashboard):
  - **Arbitrage** — when YES and NO can be bought for less than $1 combined, buys both
    legs for a risk-free edge.
  - **Momentum** — rides fast short-window price moves.
  - **Copy-trading** — mirrors the trades of top-PnL wallets from the leaderboard (or
    wallets you specify), scaled to your account.
- **Risk controls** — per-market and total exposure caps, configurable order size,
  modelled slippage and fees.
- **Dashboard** — live equity & PnL, open positions, fills, the signal log, the
  leaderboard you're copying, and one-tap manual Buy/Sell on any market.

## Configuration

Copy `.env.example` to `.env` and edit. Highlights:

| Variable | Meaning |
| --- | --- |
| `PM_STARTING_BALANCE` | Virtual USDC to start with |
| `PM_FORCE_MOCK` | Force the mock feed even if Polymarket is reachable |
| `PM_ORDER_SIZE_USD` | Default notional per strategy order |
| `PM_MAX_POSITION_USD` / `PM_MAX_EXPOSURE_USD` | Risk caps |
| `PM_STRAT_ARB` / `PM_STRAT_MOMENTUM` / `PM_STRAT_COPY` | Enable/disable strategies |
| `PM_COPY_WALLETS` / `PM_COPY_TOP_N` / `PM_COPY_SCALE` | Copy-trading targets & sizing |

See `.env.example` for the full list and `CLAUDE.md` for the architecture.
