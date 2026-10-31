// Request handler: single-page app, JSON API and receipt files, served behind Home Assistant Ingress
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, readFileSync } from 'node:fs';
import type { Op } from '../shared/state';
import type { Store } from './db';
import { MAX_RECEIPT_BYTES, cleanFileName, contentDisposition, sniffMime, writeZip, type ZipEntry } from './files';

// Home Assistant Supervisor proxies Ingress traffic from this address only
const INGRESS_IP = '172.30.32.2';
const MAX_JSON = 10 * 1024 * 1024;

export interface AppOptions {
  allowAnyClient?: boolean; // development only
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const clientIp = (req: IncomingMessage) => (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');

const header = (req: IncomingMessage, name: string) => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

const decode = (v: string) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

/** Display name of the Home Assistant user, passed by Ingress. */
export function haUser(req: IncomingMessage): string | undefined {
  const v = header(req, 'x-remote-user-display-name') ?? header(req, 'x-remote-user-name');
  return v ? decode(v).slice(0, 80) : undefined;
}

const SECURITY_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS });
  res.end(data);
}

async function readBody(req: IncomingMessage, limit: number, tooLarge: string): Promise<Buffer> {
  const declared = Number(header(req, 'content-length') ?? 0);
  if (declared > limit) throw new HttpError(413, tooLarge);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, tooLarge);
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const buf = await readBody(req, MAX_JSON, 'Request too large');
  try {
    return JSON.parse(buf.toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

/** Unique, readable paths for the ZIP export: "<template or tracker>/<YYYY-MM>_<file name>". */
function zipEntries(store: Store): ZipEntry[] {
  const used = new Set<string>();
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || '_';
  return store.allReceipts()
    .sort((a, b) => a.owner.localeCompare(b.owner) || a.at.localeCompare(b.at))
    .map(r => {
      const base = `${safe(r.owner)}/${r.period ?? r.at}_${cleanFileName(r.fileName, r.mime)}`;
      let name = base;
      for (let i = 2; used.has(name); i++) name = base.replace(/(\.[^./]+)?$/, `-${i}$1`);
      used.add(name);
      return { name, data: () => readFileSync(r.path), date: new Date(r.createdAt) };
    });
}

export function createHandler(store: Store, indexHtml: Buffer, opts: AppOptions = {}) {
  const stateFor = (req: IncomingMessage) => {
    const me = haUser(req);
    return { ...store.state(), ...(me ? { me: { name: me } } : {}) };
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!opts.allowAnyClient && clientIp(req) !== INGRESS_IP) return send(res, 403, { error: 'Access is only allowed through Home Assistant.' });

    // Ingress strips its prefix, so paths arrive relative to the app root
    const url = new URL(req.url ?? '/', 'http://local');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method ?? 'GET';
    let m: RegExpMatchArray | null;

    if (path === '/api/health') return send(res, 200, { ok: true });
    if (path === '/api/state' && method === 'GET') return send(res, 200, stateFor(req));

    if (path === '/api/ops' && method === 'POST') {
      const body = await readJson(req);
      if (!Array.isArray(body.ops)) throw new HttpError(400, 'Expected { ops: [] }');
      store.apply(body.ops as Op[], haUser(req));
      return send(res, 200, stateFor(req));
    }

    if (path === '/api/import' && method === 'POST') {
      const body = await readJson(req);
      try {
        const counts = store.importBackup(body, haUser(req));
        return send(res, 200, { counts, state: stateFor(req) });
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : 'Import failed');
      }
    }

    // POST api/payments/:id/receipts – raw file body, name in X-File-Name (URI-encoded)
    if ((m = path.match(/^\/api\/payments\/([\w-]{1,64})\/receipts$/)) && method === 'POST') {
      if (!store.paymentExists(m[1])) throw new HttpError(404, 'Zapis o plaćanju više ne postoji.');
      const data = await readBody(req, MAX_RECEIPT_BYTES, 'Datoteka je veća od 15 MB.');
      const mime = sniffMime(data);
      if (!mime) throw new HttpError(415, 'Potvrda mora biti PDF ili slika (JPG, PNG, WEBP, HEIC).');
      const receipt = store.addReceipt(m[1], { fileName: decode(header(req, 'x-file-name') ?? ''), mime, data }, haUser(req));
      return send(res, 201, { receipt, state: stateFor(req) });
    }

    if (path === '/api/receipts.zip' && method === 'GET') {
      const entries = zipEntries(store);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': contentDisposition('attachment', `potvrde-${new Date().toISOString().slice(0, 10)}.zip`),
        ...SECURITY_HEADERS,
      });
      writeZip(entries, chunk => res.write(chunk));
      return res.end();
    }

    if ((m = path.match(/^\/api\/receipts\/([\w-]{1,64})$/))) {
      if (method === 'GET') {
        const r = store.getReceipt(m[1]);
        if (!r) throw new HttpError(404, 'Potvrda ne postoji.');
        res.writeHead(200, {
          'Content-Type': r.mime,
          'Content-Length': r.size,
          'Content-Disposition': contentDisposition(url.searchParams.has('download') ? 'attachment' : 'inline', r.fileName),
          // receipts are user uploads: never let them run scripts
          'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
          ...SECURITY_HEADERS,
          'Cache-Control': 'private, max-age=86400, immutable',
        });
        return createReadStream(r.path).pipe(res);
      }
      if (method === 'DELETE') {
        if (!store.deleteReceipt(m[1])) throw new HttpError(404, 'Potvrda ne postoji.');
        return send(res, 200, stateFor(req));
      }
    }

    if (path.startsWith('/api/')) throw new HttpError(404, 'Not found');
    if (method === 'GET' || method === 'HEAD') return send(res, 200, indexHtml, 'text/html; charset=utf-8');
    throw new HttpError(405, 'Method not allowed');
  }

  return (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch(e => {
      const status = e instanceof HttpError ? e.status : (e as { status?: number }).status ?? 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'Server error' : (e as Error).message });
      else res.destroy();
      // drain the rest of a rejected upload so the client receives the response
      req.resume();
    });
  };
}
