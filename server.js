import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as mcp from './src/mcp.js';

// 7000 (code-hub), 7100 (code-kanban), 8787 (code-conductor) and 9419/9420
// (code-share) are taken. Under the supervisor $PORT is always injected; this
// default only matters for a hand-run `node server.js`.
const DEFAULT_PORT = 7200;
const MAX_BODY_BYTES = 256 * 1024;

function send(res, status, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': buf.length });
  res.end(buf);
}

// Reject on overflow as it happens rather than buffering the whole body first.
// The request is NOT destroyed on overflow: tearing down the socket mid-upload
// would take the 413 response with it. Instead stop accumulating and keep
// draining, so the client can finish sending and still read the reply.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    let over = false;
    req.on('data', (c) => {
      if (over) return;
      n += c.length;
      if (n > MAX_BODY_BYTES) {
        over = true;
        chunks.length = 0;
        reject(Object.assign(new Error('request body too large'), { tooLarge: true }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function route(req, res) {
  // Parse the URL rather than comparing req.url: it carries the query string.
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/api/health') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('allow', 'GET, HEAD');
      req.resume();
      return send(res, 405, { error: 'method not allowed' });
    }
    req.resume();
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/mcp') {
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST');
      req.resume();
      return send(res, 405, { error: 'method not allowed' });
    }
    let raw;
    try {
      raw = await readBody(req);
    } catch (e) {
      return send(res, e.tooLarge ? 413 : 400, { error: e.message });
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A malformed body is a transport failure, not a tool outcome: the host
      // bridge always sends valid JSON, so this means something upstream broke.
      return send(res, 400, { error: 'invalid JSON body' });
    }
    const { status, body } = await mcp.handle(parsed);
    return send(res, status, body);
  }

  // Draining is mandatory on every path that doesn't read the body — an unread
  // request body stalls the keep-alive socket. (express did this for us.)
  req.resume();
  return send(res, 404, { error: 'not found' });
}

export function createServer() {
  return http.createServer((req, res) => {
    route(req, res).catch((e) => {
      if (!res.headersSent) send(res, 500, { error: e.message });
      else res.end();
    });
  });
}

// listen with retry-on-EADDRINUSE — mirrors code-kanban/code-hub: a
// just-restarted instance may find the old listening socket lingering briefly.
function listenWithRetry(server, port, host, { tries = 40, delayMs = 100 } = {}) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      const onErr = (e) => {
        server.off('listening', onOk);
        if (e.code === 'EADDRINUSE' && left > 0) setTimeout(() => attempt(left - 1), delayMs);
        else reject(e);
      };
      const onOk = () => { server.off('error', onErr); resolve(); };
      server.once('error', onErr);
      server.once('listening', onOk);
      server.listen(port, host);
    };
    attempt(tries);
  });
}

export async function start({
  port = Number(process.env.PORT) || DEFAULT_PORT,
  // Never 0.0.0.0: the endpoint has no authentication.
  host = process.env.HOST || '127.0.0.1',
} = {}) {
  const server = createServer();
  await listenWithRetry(server, port, host);
  // eslint-disable-next-line no-console
  console.log(`code-karpathy-wiki listening on http://${host}:${server.address().port}`);
  return server;
}

// Direct-run guard: only auto-start under `node server.js`, so the module stays
// importable from tests.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch((e) => { console.error(e); process.exit(1); });
}
