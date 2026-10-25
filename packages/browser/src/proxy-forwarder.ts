// A browser session's own local proxy (spec 2026-10-24 proxy §3.2; final review I1). Playwright hands a context's proxy
// credentials to every HTTP auth challenge, a website's 401 included, so Chromium must never hold the real ones. With a
// credentialed upstream, Chromium talks to this forwarder instead: on 127.0.0.1 only, behind a random per-session
// Basic credential, it adds the upstream's Proxy-Authorization and carries the request on. A website that answers 401
// collects only the throwaway loopback credential, which is worthless off this machine and after the session.
//
// CONNECT → the upstream's CONNECT, then a pipe; an absolute-URI request → the same request through the upstream. The
// upstream's refusal (a 407, a 403, a 502…) goes back as the same status, so Chromium and the session's proxy check see
// the proxy failing exactly as they would talking to it directly. Nothing here is ever logged: neither credential, nor
// a target.
import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as netConnect, type AddressInfo, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { ProxySettings } from './types.js';

/** The forwarder as Chromium's context proxy: its address and its session credential. */
export type ProxyForwarder = { server: string; port: number; username: string; password: string; close(): Promise<void> };

/** How long the upstream gets to answer a CONNECT before the tunnel is given up (502). */
const UPSTREAM_TIMEOUT_MS = 30_000;

const REASONS: Record<number, string> = { 400: 'Bad Request', 403: 'Forbidden', 407: 'Proxy Authentication Required', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' };

let open = 0;
/** Forwarders listening in this process — for the tests' "none left after close". */
export function activeProxyForwarders(): number {
  return open;
}

type Upstream = { tls: boolean; host: string; port: number; auth: string };

/** The upstream's scheme, host, port and Proxy-Authorization; an http(s) proxy only (a socks5 one with a password is
 *  refused at save and as a default, and Chromium could not use one anyway). */
function upstreamOf(proxy: ProxySettings): Upstream {
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(proxy.server) ? proxy.server : `http://${proxy.server}`); } catch {
    throw new Error('The proxy address could not be read.');
  }
  const scheme = u.protocol.replace(/:$/, '').toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') throw new Error(`A ${scheme} proxy with a password is not supported.`);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new Error('The proxy address could not be read.');
  const port = Number(u.port || (scheme === 'https' ? 443 : 80));
  const auth = `Basic ${Buffer.from(`${proxy.username ?? ''}:${proxy.password ?? ''}`).toString('base64')}`;
  return { tls: scheme === 'https', host, port, auth };
}

/** Whether a request carries exactly this session's credential (constant time). */
function carries(headers: IncomingHttpHeaders, expected: Buffer): boolean {
  const got = Buffer.from(String(headers['proxy-authorization'] ?? ''));
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const statusLine = (status: number) => `HTTP/1.1 ${status} ${REASONS[status] ?? 'Proxy Answer'}\r\n`;
/** A 407 that asks Chromium for the session credential (Playwright answers it); any other refusal, empty. */
const refusal = (status: number) =>
  `${statusLine(status)}${status === 407 ? 'Proxy-Authenticate: Basic realm="proxy"\r\n' : ''}Content-Length: 0\r\nConnection: close\r\n\r\n`;

/** `host:port` for a CONNECT (an IPv6 literal in brackets). */
const authorityOf = (host: string, port: number) => `${host.includes(':') ? `[${host}]` : host}:${port}`;

/**
 * Starts a forwarder to `upstream` (which has credentials) on 127.0.0.1, a random port, with a fresh random credential.
 * It rejects every request without that credential (407) and closes with `close()` — every open tunnel with it.
 */
export async function startProxyForwarder(upstreamProxy: ProxySettings): Promise<ProxyForwarder> {
  const upstream = upstreamOf(upstreamProxy);
  const username = `s-${randomBytes(8).toString('hex')}`;
  const password = randomBytes(24).toString('hex');
  const expected = Buffer.from(`Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`);
  const sockets = new Set<Socket>();
  const track = (s: Socket) => { sockets.add(s); s.once('close', () => sockets.delete(s)); return s; };

  /** An absolute-URI request: the same request through the upstream, its answer (a refusal included) back as it is. */
  const onRequest = (req: IncomingMessage, res: ServerResponse) => {
    if (!carries(req.headers, expected)) {
      res.writeHead(407, { 'proxy-authenticate': 'Basic realm="proxy"', 'content-length': '0', connection: 'close' });
      res.end();
      return;
    }
    if (!/^https?:\/\//i.test(req.url ?? '')) { res.writeHead(400, { 'content-length': '0' }).end(); return; }
    const headers: IncomingHttpHeaders = { ...req.headers, 'proxy-authorization': upstream.auth };
    delete headers['proxy-connection'];
    const send = upstream.tls ? httpsRequest : httpRequest;
    const out = send({
      host: upstream.host,
      port: upstream.port,
      method: req.method,
      path: req.url,
      headers,
      agent: false,
      ...(upstream.tls ? { servername: upstream.host.includes(':') ? undefined : upstream.host } : {}),
    }, (up) => {
      const answer = { ...up.headers };
      // The upstream's own challenge never reaches Chromium: a 407 asks only for the session credential.
      if (up.statusCode === 407) answer['proxy-authenticate'] = 'Basic realm="proxy"';
      res.writeHead(up.statusCode ?? 502, answer);
      up.pipe(res);
    });
    out.on('socket', (s) => track(s));
    out.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-length': '0' });
      res.end();
    });
    req.pipe(out);
    res.on('close', () => out.destroy());
  };

  const server = createServer(onRequest);

  /** CONNECT: the upstream's CONNECT with its credential; a 200 opens the pipe, anything else goes back as it is. */
  server.on('connect', (req: IncomingMessage, client: Socket, head: Buffer) => {
    client.on('error', () => { /* Chromium went away; the upstream side is closed below */ });
    if (!carries(req.headers, expected)) { client.end(refusal(407)); return; }
    const target = req.url ?? '';
    let authority: URL | null = null;
    try { authority = new URL(`http://${target}`); } catch { /* answered below */ }
    if (!authority?.hostname || !authority.port) { client.end(refusal(400)); return; }
    const targetAuthority = authorityOf(authority.hostname.replace(/^\[|\]$/g, ''), Number(authority.port));
    const up = track(upstream.tls
      ? tlsConnect({ host: upstream.host, port: upstream.port, servername: upstream.host.includes(':') ? undefined : upstream.host })
      : netConnect(upstream.port, upstream.host));
    let settled = false;
    const fail = (status: number) => {
      if (settled) return;
      settled = true;
      up.destroy();
      if (!client.destroyed) client.end(refusal(status));
    };
    const timer = setTimeout(() => fail(504), UPSTREAM_TIMEOUT_MS);
    up.on(upstream.tls ? 'secureConnect' : 'connect', () => {
      up.write(`CONNECT ${targetAuthority} HTTP/1.1\r\nHost: ${targetAuthority}\r\nProxy-Authorization: ${upstream.auth}\r\n\r\n`);
    });
    up.on('error', () => { clearTimeout(timer); if (settled) client.destroy(); else fail(502); });
    up.on('close', () => { clearTimeout(timer); if (settled) client.destroy(); else fail(502); });
    client.on('close', () => { clearTimeout(timer); up.destroy(); });
    let buf = Buffer.alloc(0);
    const onHead = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) { if (buf.length > 16_384) fail(502); return; }
      up.off('data', onHead);
      clearTimeout(timer);
      const status = Number(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(buf.subarray(0, end).toString('latin1'))?.[1] ?? NaN);
      if (status !== 200) { fail(Number.isNaN(status) ? 502 : status); return; }
      settled = true;
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      const rest = buf.subarray(end + 4);
      if (rest.length) client.write(rest);
      if (head.length) up.write(head);
      up.pipe(client);
      client.pipe(up);
    };
    up.on('data', onHead);
  });
  server.on('connection', (s: Socket) => { track(s); });
  server.on('clientError', (_err, s: Socket) => { s.destroy(); });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  open++;
  const port = (server.address() as AddressInfo).port;
  let closing: Promise<void> | null = null;
  return {
    server: `http://127.0.0.1:${port}`,
    port,
    username,
    password,
    close: () => closing ??= new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => { open--; resolve(); });
    }),
  };
}
