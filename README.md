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

## One-click deploy (get a link you can open on your phone)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/adamhassan66/algooo/tree/claude/claude-md-docs-jv9dmi)

Tap the button, sign in with GitHub, and Render builds it from `render.yaml` and
gives you a public `https://…onrender.com` URL — open that on your iPhone and add it
to the Home Screen. (Free tier sleeps after ~15 min idle and cold-starts in ~30s.)

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

## Going live (real wallet)

PolyBot ships **ready to connect to a real Polymarket wallet**, but live trading is
**off by default** — nothing trades real money until you explicitly arm it. The live
path authenticates your wallet, derives CLOB API credentials, and submits signed
marketable (FOK) orders via Polymarket's official client.

To arm it:

1. **Install the live deps** (kept optional so the paper bot stays zero-install):
   ```bash
   npm install @polymarket/clob-client ethers
   ```
   > Uses **ethers v5** — `@polymarket/clob-client` is not compatible with ethers v6.
2. In the Polymarket app, **deposit USDC on Polygon** and approve trading (this sets
   the on-chain allowances the bot relies on).
3. Set these (ideally via your host's secret manager, **not** a committed file):
   ```bash
   PM_LIVE_TRADING=true
   PM_PRIVATE_KEY=0x...        # the EOA key that controls your account
   PM_FUNDER_ADDRESS=0x...     # your Polymarket proxy/safe address (if applicable)
   PM_SIGNATURE_TYPE=1         # 0=EOA, 1=Polymarket proxy, 2=Gnosis safe
   ```
4. Start the app. In live mode the bot **does not auto-start** — the dashboard shows a
   red **LIVE** badge and you must press **Start** to begin trading real funds.

Safety behavior: if the deps are missing or the wallet can't be initialized, the bot
**refuses to arm and stays in paper mode** rather than trading in an unknown state.

In live mode the dashboard **reconciles against your real wallet**: it pulls your USDC
balance (CLOB) and open positions (Data API) on arm, every `PM_LIVE_SYNC_MS` (default
10s), and right after each fill — so equity, positions, and PnL reflect on-chain truth
rather than a guess. PnL is rebased to the equity observed when the bot armed, so it
tracks the session. The header shows the wallet and "synced Ns ago".

> Caveats before you trust it with size: risk limits are enforced on intended order
> size, not realized fills; reconciliation depends on the Data API being reachable from
> where you host it; and the live order path should be exercised with tiny amounts
> first. Start small.

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
