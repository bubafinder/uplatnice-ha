// Entry point: configuration from the environment, then start the HTTP server
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHandler } from './app';
import { Store } from './db';

const PORT = Number(process.env.PORT ?? 8099);
const DB_FILE = process.env.DB_FILE ?? '/data/uplatnice.db';
const WEB_DIR = process.env.WEB_DIR ?? join(import.meta.dirname, 'web');

// SQLite does not create missing directories (e.g. ./data during local development)
mkdirSync(dirname(DB_FILE), { recursive: true });
const store = new Store(DB_FILE);
const handler = createHandler(store, readFileSync(join(WEB_DIR, 'index.html')), { allowAnyClient: process.env.ALLOW_ANY_CLIENT === '1' });

const server = createServer(handler);
server.listen(PORT, () => console.log(`Uplatnice listening on :${PORT} (db: ${DB_FILE}, receipts: ${store.receiptsDir})`));

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    server.close();
    store.close();
    process.exit(0);
  });
}
