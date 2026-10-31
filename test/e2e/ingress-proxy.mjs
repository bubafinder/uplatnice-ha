// Development helper that mimics Home Assistant Ingress:
// the app is served under /api/hassio_ingress/<token>/ with the HA user headers,
// and /hassio/ingress/uplatnice shows it inside an iframe like the HA sidebar does.
import http from 'node:http';

const TARGET = Number(process.env.TARGET_PORT ?? 8099);
const PORT = Number(process.env.PORT ?? 8123);
const TOKEN = 'dev-token-123';
const PREFIX = `/api/hassio_ingress/${TOKEN}`;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/hassio/ingress/uplatnice') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Home Assistant</title><style>body{margin:0}iframe{border:0;width:100vw;height:100vh;display:block}</style><iframe id="ingress" src="${PREFIX}/"></iframe>`);
  }
  if (!url.pathname.startsWith(PREFIX)) {
    res.writeHead(404);
    return res.end('not found');
  }
  // the user can be switched with a cookie to simulate a second family member
  const user = /(?:^|;\s*)ha_user=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? 'Ivan';
  const upstream = http.request({
    host: '127.0.0.1', port: TARGET, method: req.method,
    path: (url.pathname.slice(PREFIX.length) || '/') + url.search,
    headers: { ...req.headers, 'x-ingress-path': PREFIX, 'x-remote-user-name': user.toLowerCase(), 'x-remote-user-display-name': encodeURIComponent(user) },
  }, up => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end('upstream error'); });
  req.pipe(upstream);
}).listen(PORT, () => console.log(`Ingress mock on http://127.0.0.1:${PORT}/hassio/ingress/uplatnice`));
