// HTTP server: serves the single-page app and a small JSON API behind Home Assistant Ingress
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Op } from '../shared/state';
import { Store } from './db';

const PORT = Number(process.env.PORT ?? 8099);
const DB_FILE = process.env.DB_FILE ?? '/data/uplatnice.db';
const WEB_DIR = process.env.WEB_DIR ?? join(import.meta.dirname, 'web');
// Home Assistant Supervisor proxies Ingress traffic from this address only
const INGRESS_IP = '172.30.32.2';
const ALLOW_ANY = process.env.ALLOW_ANY_CLIENT === '1'; // development only
const MAX_BODY = 10 * 1024 * 1024;

const store = new Store(DB_FILE);
const indexHtml = readFileSync(join(WEB_DIR, 'index.html'));

function clientIp(req: IncomingMessage) {
  return (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
}

/** Display name of the Home Assistant user, passed by Ingress. */
function haUser(req: IncomingMessage): string | undefined {
  const raw = req.headers['x-remote-user-display-name'] ?? req.headers['x-remote-user-name'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return undefined;
  try {
    return decodeURIComponent(v).slice(0, 80);
  } catch {
    return v.slice(0, 80);
  }
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(data);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

const stateFor = (req: IncomingMessage) => ({ ...store.state(), me: haUser(req) ? { name: haUser(req)! } : undefined });

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (!ALLOW_ANY && clientIp(req) !== INGRESS_IP) return send(res, 403, { error: 'Access is only allowed through Home Assistant.' });

  // Ingress strips its prefix, so paths arrive relative to the app root
  const url = new URL(req.url ?? '/', 'http://local');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/api/health') return send(res, 200, { ok: true });
  if (path === '/api/state' && req.method === 'GET') return send(res, 200, stateFor(req));
  if (path === '/api/ops' && req.method === 'POST') {
    const body = await readJson(req);
    if (!Array.isArray(body.ops)) return send(res, 400, { error: 'Expected { ops: [] }' });
    store.apply(body.ops as Op[], haUser(req));
    return send(res, 200, stateFor(req));
  }
  if (path === '/api/import' && req.method === 'POST') {
    const body = await readJson(req);
    try {
      const counts = store.importBackup(body, haUser(req));
      return send(res, 200, { counts, state: stateFor(req) });
    } catch (e) {
      return send(res, 400, { error: e instanceof Error ? e.message : 'Import failed' });
    }
  }
  if (path.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
  if (req.method === 'GET' || req.method === 'HEAD') return send(res, 200, indexHtml, 'text/html; charset=utf-8');
  return send(res, 405, { error: 'Method not allowed' });
}

const server = createServer((req, res) => {
  handle(req, res).catch(e => {
    const status = (e as { status?: number }).status ?? 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Server error' : (e as Error).message });
  });
});

server.listen(PORT, () => console.log(`Uplatnice listening on :${PORT} (db: ${DB_FILE})`));

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    server.close();
    store.close();
    process.exit(0);
  });
}
