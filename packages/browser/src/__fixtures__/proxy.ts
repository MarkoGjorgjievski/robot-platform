// A tiny recording HTTP proxy for tests and the live check (spec 2026-10-24 proxy §4): absolute-URI requests are
// forwarded with FORWARDED_HEADER set, so the website can tell a proxied request from a direct one; CONNECT is
// tunnelled; every request is logged; Basic auth is optional (a wrong or missing Proxy-Authorization answers 407).
// Loopback only, never a real provider: it carries nothing to a host off this machine (403).
import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';

export const FORWARDED_HEADER = 'x-test-proxy-forwarded';
export type ProxyLogEntry = { method: string; url: string; headers: IncomingHttpHeaders; allowed: boolean };
export type RecordingProxy = { url: string; port: number; log: ProxyLogEntry[]; close(): Promise<void> };

/** `connectAnswer`: answer every (authorised) CONNECT with this status instead of tunnelling — a proxy that refuses (403)
 *  or cannot reach (502) the website. */
export type RecordingProxyOptions = { auth?: { username: string; password: string }; connectAnswer?: number };

const REASONS: Record<number, string> = { 403: 'Forbidden', 502: 'Bad Gateway', 503: 'Service Unavailable' };

/** A host name without IPv6 brackets. */
const bare = (host: string) => host.replace(/^\[|\]$/g, '');
/** This machine only: the proxy never carries a test to the internet (Task 2 review, minor 7). */
const isLoopback = (host: string) => /^(?:127(?:\.\d{1,3}){3}|::1|localhost)$/i.test(bare(host));

export async function startRecordingProxy(opts: RecordingProxyOptions = {}): Promise<RecordingProxy> {
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
    if (!isLoopback(target.hostname)) { res.writeHead(403).end(); return; }
    const headers: IncomingHttpHeaders = { ...req.headers, [FORWARDED_HEADER]: '1' };
    delete headers['proxy-authorization'];
    delete headers['proxy-connection'];
    const out = httpRequest({ host: bare(target.hostname), port: target.port || 80, path: `${target.pathname}${target.search}`, method: req.method, headers }, (up) => {
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
    if (opts.connectAnswer !== undefined) {
      client.end(`HTTP/1.1 ${opts.connectAnswer} ${REASONS[opts.connectAnswer] ?? 'Proxy Answer'}\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    // `host:port`, or `[v6]:port`: read as an authority, so an IPv6 literal keeps its colons.
    let authority: URL | null = null;
    try { authority = new URL(`http://${req.url ?? ''}`); } catch { /* answered below */ }
    if (!authority?.port || !isLoopback(authority.hostname)) {
      client.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    let established = false;
    const up = connect(Number(authority.port), bare(authority.hostname), () => {
      established = true;
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      up.write(head);
      up.pipe(client);
      client.pipe(up);
    });
    up.on('error', () => {
      if (established) client.destroy();
      else client.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
    });
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
