// Serves the built app (`vite build` → dist/) in production, e.g. in the Docker Compose stack (spec 2026-10-23
// docker-compose §3): files under dist/client as they are, everything else through the SSR handler. Node only,
// no dependencies: the SSR bundle's own imports resolve from this package's node_modules.
//   node serve.mjs            PORT (default 3000), HOST (default 0.0.0.0)
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const clientDir = join(here, 'dist', 'client');
const { default: server } = await import('./dist/server/server.js');

const types = {
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

/** A file under dist/client for this path, or null (directories, escapes and misses go to the SSR handler). */
async function staticFile(pathname) {
  let rel;
  try { rel = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, ''); } catch { return null; }
  if (rel === '' || rel.startsWith('..')) return null;
  const file = join(clientDir, rel);
  if (!file.startsWith(clientDir + sep)) return null;
  try { const s = await stat(file); return s.isFile() ? { file, size: s.size } : null; } catch { return null; }
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'GET' || req.method === 'HEAD') {
      const hit = await staticFile(url.pathname);
      if (hit) {
        res.writeHead(200, {
          'content-type': types[extname(hit.file)] ?? 'application/octet-stream',
          'content-length': hit.size,
          // Vite's hashed assets never change under one name.
          'cache-control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        });
        if (req.method === 'HEAD') return res.end();
        // A file that vanishes or fails mid-read ends this response, never the process.
        return createReadStream(hit.file).on('error', (err) => { console.error('[app] static file failed:', err.message); res.destroy(); }).pipe(res);
      }
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x)); else if (v !== undefined) headers.set(k, v);
    }
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const request = new Request(url, { method: req.method, headers, ...(hasBody ? { body: Readable.toWeb(req), duplex: 'half' } : {}) });
    const response = await server.fetch(request);
    const out = {};
    response.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) out['set-cookie'] = cookies;
    res.writeHead(response.status, out);
    if (!response.body || req.method === 'HEAD') return res.end();
    Readable.fromWeb(response.body).on('error', () => res.destroy()).pipe(res);
  } catch (err) {
    console.error('[app] request failed:', err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Internal error');
  }
}).listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '0.0.0.0', function () {
  console.log(`[app] serving dist/ on http://${process.env.HOST ?? '0.0.0.0'}:${this.address().port}`);
});
