'use strict';

// Zero-dependency HTTP server: serves the dashboard, a small JSON REST API, and
// a Server-Sent Events stream that pushes a live snapshot on every bot update.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const log = require('./util/logger');
const { MarketFeed } = require('./polymarket/feed');
const { TradingBot } = require('./engine/bot');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

// --- auth (optional PIN gate) ---------------------------------------------
// Sessions are stateless HMAC-signed tokens "<expiry>.<sig>". The signing
// secret is random per process, so a restart invalidates outstanding sessions.
const AUTH_REQUIRED = !!config.dashboardPin;
const SESSION_SECRET = crypto.randomBytes(32);
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE = 'pb_session';

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(String(value)).digest('hex');
}
function issueToken() {
  const exp = Date.now() + SESSION_TTL_MS;
  return `${exp}.${sign(exp)}`;
}
function tokenValid(token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot === -1) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(exp);
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return Number(exp) > Date.now();
}
function pinMatches(pin) {
  const a = crypto.createHash('sha256').update(String(pin || '')).digest();
  const b = crypto.createHash('sha256').update(String(config.dashboardPin)).digest();
  return crypto.timingSafeEqual(a, b);
}
function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
function isAuthed(req) {
  if (!AUTH_REQUIRED) return true;
  return tokenValid(getCookie(req, COOKIE));
}
function setSessionCookie(req, res) {
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') ? ' Secure;' : '';
  res.setHeader('set-cookie',
    `${COOKIE}=${issueToken()}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)};${secure}`);
}
function clearSessionCookie(res) {
  res.setHeader('set-cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`);
}

// In-memory login throttle, keyed by client IP. After loginMaxAttempts failures
// the IP is locked out for loginLockoutMs. Cleared on a successful login.
const loginAttempts = new Map();
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}
function loginLockRemainingMs(ip) {
  const rec = loginAttempts.get(ip);
  if (rec && rec.lockedUntil > Date.now()) return rec.lockedUntil - Date.now();
  return 0;
}
function recordLoginFailure(ip) {
  const rec = loginAttempts.get(ip) || { fails: 0, lockedUntil: 0 };
  rec.fails += 1;
  if (rec.fails >= config.loginMaxAttempts) {
    rec.lockedUntil = Date.now() + config.loginLockoutMs;
    rec.fails = 0;
    log.warn(`login locked out ${ip} for ${Math.round(config.loginLockoutMs / 1000)}s`);
  }
  loginAttempts.set(ip, rec);
}

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

    // --- auth endpoints (always reachable) ---
    if (url === '/api/auth' && req.method === 'GET') {
      return sendJson(res, 200, { required: AUTH_REQUIRED, authed: isAuthed(req) });
    }
    if (url === '/api/login' && req.method === 'POST') {
      const { pin } = await readBody(req);
      if (!AUTH_REQUIRED) return sendJson(res, 200, { ok: true });
      const ip = clientIp(req);
      const lockMs = loginLockRemainingMs(ip);
      if (lockMs > 0) {
        return sendJson(res, 429, { ok: false, error: 'too many attempts', retryAfter: Math.ceil(lockMs / 1000) });
      }
      if (pinMatches(pin)) {
        loginAttempts.delete(ip);
        setSessionCookie(req, res);
        return sendJson(res, 200, { ok: true });
      }
      recordLoginFailure(ip);
      const left = loginLockRemainingMs(ip);
      return sendJson(res, 401, left > 0
        ? { ok: false, error: 'too many attempts', retryAfter: Math.ceil(left / 1000) }
        : { ok: false, error: 'incorrect PIN' });
    }
    if (url === '/api/logout' && req.method === 'POST') {
      clearSessionCookie(res);
      return sendJson(res, 200, { ok: true });
    }

    // --- everything else under /api requires a valid session ---
    if (url.startsWith('/api/') && !isAuthed(req)) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }

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
    if (url === '/api/history' && req.method === 'GET') return sendJson(res, 200, bot.history);
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
    if (url === '/api/source' && req.method === 'POST') {
      const { source } = await readBody(req);
      if (!['live', 'mock', 'auto'].includes(source)) return sendJson(res, 400, { error: 'source must be live|mock|auto' });
      const result = await feed.switchSource(source);
      broadcast('update', bot.snapshot());
      return sendJson(res, result.ok ? 200 : 400, result);
    }
    if (url === '/api/connect' && req.method === 'POST') {
      const { privateKey, funderAddress, signatureType } = await readBody(req);
      const result = await bot.connectLive({
        privateKey,
        funderAddress,
        signatureType: signatureType === undefined || signatureType === '' ? undefined : Number(signatureType),
      });
      // Never echo the key back.
      return sendJson(res, result.ok ? 200 : 400, result);
    }
    if (url === '/api/disconnect' && req.method === 'POST') {
      return sendJson(res, 200, bot.disconnectLive());
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
