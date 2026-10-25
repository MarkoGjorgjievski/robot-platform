// A tiny recording HTTP proxy for tests and the live check (spec 2026-10-24 proxy §4): absolute-URI requests are
// forwarded with FORWARDED_HEADER set, so the website can tell a proxied request from a direct one; CONNECT is
// tunnelled; every request is logged; Basic auth is optional (a wrong or missing Proxy-Authorization answers 407).
// Loopback only, never a real provider.
import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';

export const FORWARDED_HEADER = 'x-test-proxy-forwarded';
export type ProxyLogEntry = { method: string; url: string; headers: IncomingHttpHeaders; allowed: boolean };
export type RecordingProxy = { url: string; port: number; log: ProxyLogEntry[]; close(): Promise<void> };

export async function startRecordingProxy(opts: { auth?: { username: string; password: string } } = {}): Promise<RecordingProxy> {
  const log: ProxyLogEntry[] = [];
  const expected = opts.auth ? `Basic ${Buffer.from(`${opts.auth.username}:${opts.auth.password}`).toString('base64')}` : null;
  const allowed = (h: IncomingHttpHeaders) => expected === null || h['proxy-authorization'] === expected;
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    const ok = allowed(req.headers);
    log.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, allowed: ok });
    if (!ok) {
      res.writeHead(407, { 'proxy-authenticate': 'Basic realm="test"', 'content-type': 'text/plain' });
      res.end('proxy authentication required');
      return;
    }
    let target: URL;
    try { target = new URL(req.url ?? ''); } catch { res.writeHead(400).end(); return; }
    const headers: IncomingHttpHeaders = { ...req.headers, [FORWARDED_HEADER]: '1' };
    delete headers['proxy-authorization'];
    delete headers['proxy-connection'];
    const out = httpRequest({ host: target.hostname, port: target.port || 80, path: `${target.pathname}${target.search}`, method: req.method, headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    out.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(out);
  });
  server.on('connect', (req, client: Socket, head: Buffer) => {
    const ok = allowed(req.headers);
    log.push({ method: 'CONNECT', url: req.url ?? '', headers: req.headers, allowed: ok });
    if (!ok) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="test"\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const [host, port] = (req.url ?? '').split(':');
    const up = connect(Number(port), host!, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      up.write(head);
      up.pipe(client);
      client.pipe(up);
    });
    up.on('error', () => client.destroy());
    client.on('error', () => up.destroy());
  });
  server.on('connection', (s: Socket) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    log,
    close: () => new Promise<void>((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  };
}
