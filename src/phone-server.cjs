// Terminator on your phone: a small web server inside the app that serves a phone version of Terminator
// (dist/mobile.html) and a token-protected API. It listens only on Tailscale addresses (100.64.0.0/10, so it is
// reachable from your own devices anywhere) and on 127.0.0.1 — never on the Wi-Fi/LAN address.
// Every /api request needs the pairing token (Authorization: Bearer … or ?t=… for the event stream).
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');

const PORT = 47821;
const STATIC = {
  '/': ['mobile.html', 'text/html; charset=utf-8'],
  '/mobile.js': ['mobile.js', 'text/javascript; charset=utf-8'],
  '/mobile.css': ['mobile.css', 'text/css; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/icon.png': ['icon.png', 'image/png'],
};

function tailscaleAddresses() {
  const found = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
    if (a.family !== 'IPv4' || a.internal) continue;
    const [x, y] = a.address.split('.').map(Number);
    if (x === 100 && y >= 64 && y <= 127) found.push(a.address);
  }
  return found;
}
function sameToken(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

// api: {state(), buffer(id), input(id, data), send(id, text), watch(id, size|null), token()}
function createPhoneServer({distDir, api, extraHosts = [], port = PORT}) {
  const servers = new Map(), clients = new Set();
  let timer = null;

  function json(res, code, body) { res.writeHead(code, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(body)); }
  function readBody(req) {
    return new Promise((resolve, reject) => { let body = ''; req.setEncoding('utf8');
      req.on('data', c => { body += c; if (body.length > 1e6) { reject(Error('Too large')); req.destroy(); } });
      req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } }); });
  }
  async function handle(req, res) {
    const url = new URL(req.url, 'http://phone');
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      try { const data = fs.readFileSync(path.join(distDir, file)); res.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-cache'}); res.end(data); }
      catch { res.writeHead(404); res.end(); }
      return;
    }
    if (!url.pathname.startsWith('/api/')) { res.writeHead(404); res.end(); return; }
    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('t');
    if (!sameToken(auth, api.token())) { json(res, 401, {error: 'Pair this phone again from Terminator on your Mac.'}); return; }
    try {
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, api.state());
      if (req.method === 'GET' && url.pathname === '/api/buffer') { const b = api.buffer(url.searchParams.get('id')); return json(res, 200, typeof b === 'string' ? {data: b} : b); }
      if (req.method === 'GET' && url.pathname === '/api/events') return events(req, res, url);
      if (req.method === 'POST' && url.pathname === '/api/input') { const b = await readBody(req); api.input(b.id, b.data); return json(res, 200, {ok: true}); }
      if (req.method === 'POST' && url.pathname === '/api/send') { const b = await readBody(req); await api.send(b.id, b.text); return json(res, 200, {ok: true}); }
      if (req.method === 'POST' && url.pathname === '/api/action') { const b = await readBody(req); return json(res, 200, await api.action(b) || {ok: true}); }
      json(res, 404, {error: 'Unknown request.'});
    } catch (error) { json(res, 400, {error: error.message || String(error)}); }
  }
  // Server-sent events: state changes for everything, terminal output only for the terminal being watched.
  function events(req, res, url) {
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'});
    const watch = url.searchParams.get('watch') || null, cols = Number(url.searchParams.get('cols')), rows = Number(url.searchParams.get('rows'));
    const client = {res, watch};
    clients.add(client);
    if (watch) api.watch(watch, Number.isInteger(cols) && Number.isInteger(rows) ? {cols, rows} : null, true);
    res.write(`event: hello\ndata: {}\n\n`);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(ping); clients.delete(client); if (watch && ![...clients].some(c => c.watch === watch)) api.watch(watch, null, false); });
  }
  function broadcast(event, data, terminalId = null) {
    if (!clients.size) return;
    const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) if (!terminalId || c.watch === terminalId) c.res.write(line);
  }
  function watching(id) { return [...clients].some(c => c.watch === id); }

  function listenOn(host) {
    if (servers.has(host)) return;
    const server = http.createServer((req, res) => { handle(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch {} }); });
    server.on('error', () => { servers.delete(host); });
    server.listen(port, host); servers.set(host, server);
  }
  function refresh() {
    const wanted = new Set(['127.0.0.1', ...tailscaleAddresses(), ...extraHosts]);
    for (const host of wanted) listenOn(host);
    for (const [host, server] of servers) if (!wanted.has(host)) { server.close(); servers.delete(host); }
  }
  function start() { refresh(); timer = setInterval(refresh, 15000); timer.unref?.(); }
  function stop() { clearInterval(timer); timer = null; for (const c of clients) { try { c.res.end(); } catch {} } clients.clear(); for (const s of servers.values()) s.close(); servers.clear(); }
  function addresses() { return [...servers.keys()].filter(h => h !== '127.0.0.1'); }
  return {start, stop, broadcast, watching, addresses, running: () => servers.size > 0, PORT: port};
}
module.exports = {createPhoneServer, tailscaleAddresses, PORT};
