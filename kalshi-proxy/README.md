# Kalshi read-only proxy

A tiny [Cloudflare Worker](https://workers.cloudflare.com/) that lets the
Cockpit app read **live Kalshi market odds** (and, optionally, your real
balance) from a phone browser — without the CORS error, and **without ever
putting your API keys in the public web app.**

## What it does — and what it deliberately doesn't

- ✅ `GET /btc` — the nearest open BTC market (public data, **no key needed**)
- ✅ `GET /markets?series_ticker=XYZ` — open markets for a series (public)
- ✅ `GET /balance` — your portfolio balance, **read-only** (needs your key)
- ❌ It **cannot place, cancel, or change orders.** There is no such code.
  Your money cannot be moved through this Worker.

Your keys live only in Cloudflare's encrypted secrets — never in this repo,
never in the web app, never visible to anyone (including me).

## Deploy (about 5 minutes)

You need Node installed. Then:

```bash
npm install -g wrangler          # Cloudflare's CLI
wrangler login                   # opens a browser to your Cloudflare account
cd kalshi-proxy
wrangler deploy                  # prints your Worker URL
```

You'll get a URL like `https://kalshi-proxy.<your-subdomain>.workers.dev`.

### Recommended: lock it with a token

So only your app can use the Worker:

```bash
wrangler secret put ACCESS_TOKEN
# paste any long random string when prompted (also paste it into the app)
```

### Optional: real balance (read-only)

Only if you want the app to show your **real** Kalshi balance. In Kalshi →
Settings → **API Keys**, create a key; you get a **Key ID** and download an
**RSA private key** file (PEM). Then:

```bash
wrangler secret put KALSHI_KEY_ID        # paste the Key ID
wrangler secret put KALSHI_PRIVATE_KEY   # paste the full PEM (-----BEGIN...-----)
```

Leave these unset and `/balance` simply stays off. Live odds still work.

### Optional: lock CORS to the app's origin

```bash
wrangler secret put ALLOW_ORIGIN
# e.g. https://raw.githack.com
```

## Connect it to the app

Open the Cockpit → **Trade** tab → **Connect (read-only)** in the Live Kalshi
card. Paste your Worker URL and (if you set one) the token. That's it — the
live odds card fills in, and the bot will use the real Kalshi prices while
still trading **mock money** so you can prove it out safely first.

## Test it yourself

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" https://kalshi-proxy.<sub>.workers.dev/btc
```
