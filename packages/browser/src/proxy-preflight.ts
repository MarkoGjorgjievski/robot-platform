// Spec 2026-10-24 proxy §2.2 "A failing proxy": before a proxied browser's first page on a host, ask the proxy from
// Node whether it will carry us there. Chromium never surfaces a 407 on CONNECT (an https target, i.e. every real
// shop): it hangs until the navigation timeout, which reads as the website being slow (Task 2 review, issue 1). The
// check talks to the proxy only — the target's name goes to the proxy inside the request, never to a resolver or a
// socket of ours — and its result names no credentials.
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import type { ProxySettings } from './types.js';

export const PROXY_CHECK_TIMEOUT_MS = 10_000;

export type ProxyCheck = { ok: true } | { ok: false; detail: string };

/** The proxy's scheme, host and port; Playwright's `server` may omit the scheme (http). */
function proxyAddress(server: string): { scheme: 'http' | 'https' | 'socks5'; host: string; port: number } | null {
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(server) ? server : `http://${server}`); } catch { return null; }
  const scheme = u.protocol.replace(/:$/, '').toLowerCase();
  if (scheme !== 'http' && scheme !== 'https' && scheme !== 'socks5') return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const port = Number(u.port || (scheme === 'https' ? 443 : scheme === 'socks5' ? 1080 : 80));
  return host ? { scheme, host, port } : null;
}

/** `host:port` as a CONNECT authority (an IPv6 literal in brackets). */
function authority(host: string, port: number): string {
  return `${host.includes(':') ? `[${host}]` : host}:${port}`;
}

/**
 * One request through `proxy` toward `targetUrl`'s host: a CONNECT for an https target (any answer but 200 is the
 * proxy's failure), a HEAD with an absolute URI for an http one (only a 407 is the proxy's — any other status is the
 * website's own answer), a SOCKS5 greeting and CONNECT for a socks5 proxy. A refused, unresolvable, silent or slow
 * (`timeoutMs`) proxy fails too.
 */
export function checkProxy(proxy: ProxySettings, targetUrl: string, timeoutMs = PROXY_CHECK_TIMEOUT_MS): Promise<ProxyCheck> {
  const addr = proxyAddress(proxy.server);
  if (!addr) return Promise.resolve({ ok: false, detail: 'The proxy address could not be read.' });
  let target: URL;
  try { target = new URL(targetUrl); } catch { return Promise.resolve({ ok: true }); }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return Promise.resolve({ ok: true });
  const targetHost = target.hostname.replace(/^\[|\]$/g, '');
  const targetPort = Number(target.port || (target.protocol === 'https:' ? 443 : 80));

  return new Promise<ProxyCheck>((resolve) => {
    let done = false;
    let socket: Socket;
    const finish = (r: ProxyCheck) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket?.destroy();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, detail: `The proxy did not answer within ${Math.round(timeoutMs / 1000)} s.` }), timeoutMs);
    const onError = (err: Error & { code?: string }) => finish({ ok: false, detail: `The proxy could not be reached (${err.code ?? 'connection error'}).` });
    const onClose = () => finish({ ok: false, detail: 'The proxy closed the connection without an answer.' });

    if (addr.scheme === 'socks5') {
      socket = netConnect(addr.port, addr.host);
      socket.on('error', onError);
      socket.on('close', onClose);
      let stage: 'greeting' | 'connect' = 'greeting';
      let buf = Buffer.alloc(0);
      socket.on('connect', () => socket.write(Buffer.from([5, 1, 0])));
      socket.on('data', (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        if (stage === 'greeting') {
          if (buf.length < 2) return;
          if (buf[0] !== 5 || buf[1] !== 0) return finish({ ok: false, detail: 'The proxy refused the SOCKS5 greeting.' });
          buf = buf.subarray(2);
          stage = 'connect';
          const name = Buffer.from(targetHost, 'utf8');
          socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([targetPort >> 8, targetPort & 0xff])]));
          return;
        }
        if (buf.length < 2) return;
        finish(buf[1] === 0 ? { ok: true } : { ok: false, detail: `The proxy refused the SOCKS5 connection (reply ${buf[1]}).` });
      });
      return;
    }

    const auth = proxy.username !== undefined || proxy.password !== undefined
      ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username ?? ''}:${proxy.password ?? ''}`).toString('base64')}\r\n`
      : '';
    const https = target.protocol === 'https:';
    const head = https
      ? `CONNECT ${authority(targetHost, targetPort)} HTTP/1.1\r\nHost: ${authority(targetHost, targetPort)}\r\n${auth}\r\n`
      : `HEAD ${target.href} HTTP/1.1\r\nHost: ${target.host}\r\n${auth}Connection: close\r\n\r\n`;
    socket = addr.scheme === 'https'
      ? tlsConnect({ host: addr.host, port: addr.port, servername: addr.host.includes(':') ? undefined : addr.host })
      : netConnect(addr.port, addr.host);
    socket.on('error', onError);
    socket.on('close', onClose);
    socket.on(addr.scheme === 'https' ? 'secureConnect' : 'connect', () => socket.write(head));
    let text = '';
    socket.on('data', (chunk: Buffer) => {
      text += chunk.toString('latin1');
      const eol = text.indexOf('\r\n');
      if (eol < 0) return;
      const status = Number(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(text.slice(0, eol))?.[1] ?? NaN);
      if (Number.isNaN(status)) return finish({ ok: false, detail: 'The proxy sent an answer that is not HTTP.' });
      if (status === 407) return finish({ ok: false, detail: 'The proxy answered 407 (authentication required).' });
      if (https && status !== 200) return finish({ ok: false, detail: `The proxy answered ${status} to the tunnel request.` });
      finish({ ok: true });
    });
  });
}
