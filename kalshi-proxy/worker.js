/*
 * Kalshi read-only proxy — Cloudflare Worker.
 *
 * Why this exists: a phone browser can't call Kalshi's API directly (CORS),
 * and you must NEVER put API keys in the static web app (it's public). This
 * Worker runs on your own Cloudflare account, adds CORS headers, and is
 * strictly READ-ONLY. It never places, cancels, or modifies orders.
 *
 * Endpoints:
 *   GET /btc      -> nearest-to-close open BTC market (PUBLIC data, no key)
 *   GET /markets?series_ticker=XYZ -> raw open markets for a series (PUBLIC)
 *   GET /balance  -> your portfolio balance in cents (needs your API key;
 *                    optional — only works if you set the two secrets below)
 *
 * Secrets (set with `wrangler secret put NAME`, never committed):
 *   ACCESS_TOKEN       (recommended) shared bearer token the app must send
 *   KALSHI_KEY_ID      (optional)    your Kalshi API key id, for /balance
 *   KALSHI_PRIVATE_KEY (optional)    the RSA private key PEM, for /balance
 *   ALLOW_ORIGIN       (optional)    restrict CORS; defaults to "*"
 */

const KALSHI = "https://api.elections.kalshi.com";
const V2 = KALSHI + "/trade-api/v2";
// Candidate BTC series tickers; the Worker keeps whichever return markets.
const BTC_SERIES = ["KXBTCD", "KXBTC", "KXBTCRANGE", "KXBTC15", "KXBTCMINI"];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "authorization,content-type",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "GET") return json({ error: "read-only" }, 405, cors);

    // Optional shared-token gate so randoms can't use your Worker.
    if (env.ACCESS_TOKEN) {
      const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (got !== env.ACCESS_TOKEN) return json({ error: "unauthorized" }, 401, cors);
    }

    try {
      if (url.pathname === "/" || url.pathname === "/btc") {
        return json(await nearestBtc(), 200, cors);
      }
      if (url.pathname === "/markets") {
        const s = url.searchParams.get("series_ticker") || "";
        const r = await fetch(`${V2}/markets?status=open&limit=200${s ? `&series_ticker=${encodeURIComponent(s)}` : ""}`, { headers: { Accept: "application/json" } });
        return json(await r.json(), r.status, cors);
      }
      if (url.pathname === "/balance") {
        if (!env.KALSHI_KEY_ID || !env.KALSHI_PRIVATE_KEY) return json({ error: "balance not configured" }, 501, cors);
        const data = await signedGet(env, "/trade-api/v2/portfolio/balance");
        return json(data, 200, cors); // { balance: <cents>, ... }
      }
      return json({ error: "not found" }, 404, cors);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 502, cors);
    }
  },
};

async function nearestBtc() {
  let best = null, scanned = 0;
  for (const s of BTC_SERIES) {
    const r = await fetch(`${V2}/markets?status=open&limit=200&series_ticker=${s}`, { headers: { Accept: "application/json" } });
    if (!r.ok) continue;
    const ms = (await r.json()).markets || [];
    for (const m of ms) {
      scanned++;
      const close = Date.parse(m.close_time || m.expiration_time || "");
      if (!close || close < Date.now()) continue;
      if (!best || close < best.close) best = { m, close };
    }
  }
  if (!best) return { status: "nomarket", scanned };
  const m = best.m;
  return {
    status: "ok",
    market: {
      title: m.title || m.ticker, ticker: m.ticker, closeTime: best.close,
      upAsk: +m.yes_ask || 50, downAsk: +m.no_ask || 50,
      strike: m.cap_strike ?? m.floor_strike ?? null,
    },
  };
}

// Kalshi RSA-PSS request signing (read-only GET only).
async function signedGet(env, path) {
  const ts = Date.now().toString();
  const key = await importPkcs8(env.KALSHI_PRIVATE_KEY);
  const sig = await crypto.subtle.sign({ name: "RSA-PSS", saltLength: 32 }, key, new TextEncoder().encode(ts + "GET" + path));
  const r = await fetch(KALSHI + path, {
    headers: {
      "KALSHI-ACCESS-KEY": env.KALSHI_KEY_ID,
      "KALSHI-ACCESS-SIGNATURE": b64(sig),
      "KALSHI-ACCESS-TIMESTAMP": ts,
      Accept: "application/json",
    },
  });
  if (!r.ok) throw new Error("kalshi " + r.status);
  return r.json();
}

async function importPkcs8(pem) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", bin.buffer, { name: "RSA-PSS", hash: "SHA-256" }, false, ["sign"]);
}

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const json = (obj, status, cors) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
