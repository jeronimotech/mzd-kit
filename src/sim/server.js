// mzd-kit simulator server: builds apps on change, serves the simulator UI,
// pushes live-reload events and mounts the internet bridge at /bridge.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findApps, buildApp } from '../build/index.js';
import { createBridgeHandler } from '../bridge/index.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

function safeJoin(root, rel) {
  const p = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  return p === root || p.startsWith(root + path.sep) ? p : null;
}

function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}

/**
 * @param {{ appsDir: string, port?: number, host?: string, log?: (msg: string) => void }} o
 */
export async function startSim({ appsDir, port = 5173, host = '127.0.0.1', log = console.log }) {
  const root = path.resolve(appsDir);
  let apps = [];
  const builds = new Map(); // id -> { code?, error? }
  const clients = new Set();

  async function rebuild(reason) {
    apps = findApps(root);
    await Promise.all(apps.map(async (app) => {
      const t = Date.now();
      try {
        const r = await buildApp(app, { minify: false });
        builds.set(app.id, { code: r.code });
        log(`  ✓ ${app.id}  ${(r.bytes / 1024).toFixed(1)} KB  ${Date.now() - t} ms`);
      } catch (e) {
        builds.set(app.id, { error: String(e.message || e) });
        log(`  ✗ ${app.id}  ${String(e.message || e).split('\n')[0]}`);
      }
    }));
    if (reason) for (const c of clients) c.write(`data: ${JSON.stringify({ type: 'reload', reason })}\n\n`);
  }

  log(`Building apps in ${root}`);
  await rebuild();

  let timer = null;
  const watcher = fs.watch(root, { recursive: true }, (_e, file) => {
    if (!file || /(^|[/\\])(\.|node_modules)/.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => { log(`Changed: ${file}`); rebuild(file); }, 120);
  });

  const bridge = createBridgeHandler({ local: host === '127.0.0.1' || host === 'localhost', log: (m) => log(`  ${m}`) });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);

    if (p === '/api/apps') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(apps.map((a) => ({ id: a.id, error: builds.get(a.id)?.error || null }))));
    }

    if (p === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (p.startsWith('/bridge/')) return bridge(req, res, p.slice('/bridge'.length), url.searchParams);
    if (p === '/companion') { res.writeHead(302, { Location: '/bridge/companion' }); return res.end(); }

    const m = p.match(/^\/apps\/([^/]+)\/(.+)$/);
    if (m) {
      const app = apps.find((a) => a.id === m[1]);
      if (!app) { res.writeHead(404); return res.end(); }
      if (m[2] === 'app.js') {
        const b = builds.get(app.id) || {};
        res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
        return res.end(b.code || `window.MzdSim && MzdSim.buildError(${JSON.stringify(app.id)}, ${JSON.stringify(b.error || 'not built')});`);
      }
      const file = safeJoin(app.publicDir, m[2]);
      return file ? serveFile(res, file) : (res.writeHead(403), res.end());
    }

    const file = safeJoin(WEB, p === '/' ? '/index.html' : p);
    return file ? serveFile(res, file) : (res.writeHead(403), res.end());
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  const close = () => { watcher.close(); for (const c of clients) c.end(); server.close(); };
  return { url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`, close };
}
