'use strict';

// Zero-dependency HTTP server: serves the dashboard, a small JSON REST API, and
// a Server-Sent Events stream that pushes a live snapshot on every bot update.
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const log = require('./util/logger');
const { MarketFeed } = require('./polymarket/feed');
const { TradingBot } = require('./engine/bot');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.join(config.publicDir, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(config.publicDir)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}

async function main() {
  const feed = new MarketFeed();
  const bot = new TradingBot(feed);
  await feed.start();
  await bot.init(); // arms live trading if configured, else stays paper

  // Auto-start only in paper mode. In live mode the user must press Start in the
  // dashboard so real orders are never placed on boot without intent.
  if (bot.mode === 'paper') bot.start();
  else log.warn('LIVE mode — bot is paused; press Start in the dashboard to begin trading real funds');

  const sseClients = new Set();
  const broadcast = (event, payload) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const c of sseClients) c.write(frame);
  };
  bot.on('update', (snap) => broadcast('update', snap));
  bot.on('sourceTrade', (t) => broadcast('sourceTrade', t));

  const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];

    // --- SSE live stream ---
    if (url === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`event: update\ndata: ${JSON.stringify(bot.snapshot())}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // --- REST API ---
    if (url === '/api/state' && req.method === 'GET') return sendJson(res, 200, bot.snapshot());
    if (url === '/api/config' && req.method === 'GET') {
      return sendJson(res, 200, {
        source: feed.sourceKind, running: bot.running, mode: bot.mode,
        liveAddress: bot.liveAddress, enabled: bot.enabled,
        startingBalance: config.startingBalance, orderSizeUsd: config.orderSizeUsd,
        maxPositionUsd: config.maxPositionUsd, maxExposureUsd: config.maxExposureUsd,
        arbEdge: config.arbEdge, slippageBps: config.slippageBps,
      });
    }
    if (url === '/api/control' && req.method === 'POST') {
      const { action } = await readBody(req);
      if (action === 'start') bot.start();
      else if (action === 'stop') bot.stop();
      else if (action === 'flatten') await bot.flatten();
      else if (action === 'reset') bot.reset();
      else return sendJson(res, 400, { error: 'unknown action' });
      broadcast('update', bot.snapshot());
      return sendJson(res, 200, { ok: true, running: bot.running });
    }
    if (url === '/api/strategies' && req.method === 'POST') {
      const body = await readBody(req);
      for (const [k, v] of Object.entries(body)) bot.setStrategy(k, v);
      broadcast('update', bot.snapshot());
      return sendJson(res, 200, { ok: true, enabled: bot.enabled });
    }
    if (url === '/api/order' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await bot.manualOrder(body);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (req.method === 'GET') return serveStatic(req, res);
    res.writeHead(405); res.end('method not allowed');
  });

  server.listen(config.port, () => {
    log.info(`PolyBot dashboard on http://localhost:${config.port}  (source: ${feed.sourceKind})`);
  });
}

main().catch((e) => { log.error('fatal:', e); process.exit(1); });
