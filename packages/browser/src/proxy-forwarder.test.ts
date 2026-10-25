// The session's local forwarder (final review I1): loopback only, a random credential, the upstream's credential added
// on the way out and never handed back. Node only — the recording proxy is the upstream; no Chromium here.
import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { startRecordingProxy, type RecordingProxy } from './__fixtures__/proxy.js';
import { startProxyForwarder, activeProxyForwarders, type ProxyForwarder } from './proxy-forwarder.js';
import { checkProxy } from './proxy-preflight.js';

const UP = { username: 'shop-user', password: 'p@ss:w/rd' };
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { while (closers.length) await closers.pop()!(); });
async function upstream(opts: Parameters<typeof startRecordingProxy>[0] = { auth: UP }): Promise<RecordingProxy> {
  const p = await startRecordingProxy(opts);
  closers.push(() => p.close());
  return p;
}
async function forwarder(up: RecordingProxy, password = UP.password): Promise<ProxyForwarder> {
  const f = await startProxyForwarder({ server: up.url, username: UP.username, password });
  closers.push(() => f.close());
  return f;
}
async function site(): Promise<{ url: string; seen: http.IncomingHttpHeaders[] }> {
  const seen: http.IncomingHttpHeaders[] = [];
  const s = http.createServer((req, res) => { seen.push(req.headers); res.end('ok'); });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  closers.push(() => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); }));
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}/p/1`, seen };
}
/** An absolute-URI GET through the forwarder: the status. */
function getThrough(f: ProxyForwarder, url: string, auth?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: f.port, path: url, method: 'GET', agent: false,
      headers: { host: new URL(url).host, ...(auth ? { 'proxy-authorization': auth } : {}) } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject);
    req.end();
  });
}
const session = (f: ProxyForwarder) => ({ server: f.server, username: f.username, password: f.password });

describe('startProxyForwarder', () => {
  it('listens on 127.0.0.1 only, with a fresh random credential per session', async () => {
    const up = await upstream();
    const a = await forwarder(up);
    const b = await forwarder(up);
    expect(a.server).toBe(`http://127.0.0.1:${a.port}`);
    expect(a.password).toMatch(/^[0-9a-f]{48}$/);
    expect(a.password).not.toBe(b.password);
    expect(a.username).not.toBe(b.username);
    expect(`${a.username}:${a.password}`).not.toContain(UP.password);
  });

  it('a CONNECT with the session credential reaches the upstream with the upstream’s header, never the session’s', async () => {
    const up = await upstream();
    const s = await site();
    const f = await forwarder(up);
    expect(await checkProxy(session(f), s.url.replace(/^http:/, 'https:'))).toEqual({ ok: true });
    expect(up.log).toHaveLength(1);
    expect(up.log[0]).toMatchObject({ method: 'CONNECT', allowed: true });
    expect(up.log[0]!.headers['proxy-authorization']).toBe(basic(UP.username, UP.password));
  });

  it('an absolute-URI request goes through the upstream, which strips the credential before the website', async () => {
    const up = await upstream();
    const s = await site();
    const f = await forwarder(up);
    expect(await getThrough(f, s.url, basic(f.username, f.password))).toBe(200);
    expect(up.log).toMatchObject([{ method: 'GET', url: s.url, allowed: true }]);
    expect(up.log[0]!.headers['proxy-authorization']).toBe(basic(UP.username, UP.password));
    expect(s.seen).toHaveLength(1);
    expect(JSON.stringify(s.seen)).not.toContain(f.password);
  });

  it('refuses anything without its credential (407) and never asks the upstream', async () => {
    const up = await upstream();
    const s = await site();
    const f = await forwarder(up);
    expect(await checkProxy({ server: f.server }, s.url.replace(/^http:/, 'https:'))).toMatchObject({ ok: false, detail: 'The proxy answered 407 (authentication required).' });
    expect(await checkProxy({ server: f.server, username: f.username, password: 'nope' }, s.url.replace(/^http:/, 'https:'))).toMatchObject({ ok: false, lasting: true });
    expect(await getThrough(f, s.url)).toBe(407);
    expect(await getThrough(f, s.url, basic(UP.username, UP.password))).toBe(407);
    expect(up.log).toEqual([]);
    expect(s.seen).toEqual([]);
  });

  it('a wrong upstream password comes back as the upstream’s 407, for a CONNECT and for a plain request', async () => {
    const up = await upstream();
    const s = await site();
    const f = await forwarder(up, 'wrong');
    expect(await checkProxy(session(f), s.url.replace(/^http:/, 'https:'))).toMatchObject({ ok: false, lasting: true });
    expect(await getThrough(f, s.url, basic(f.username, f.password))).toBe(407);
    expect(up.log.every((e) => !e.allowed)).toBe(true);
    expect(s.seen).toEqual([]);
  });

  it('an upstream refusal (403) or an upstream that is gone comes back as a refusal, never a tunnel', async () => {
    const refusing = await upstream({ auth: UP, connectAnswer: 403 });
    const s = await site();
    expect(await checkProxy(session(await forwarder(refusing)), s.url.replace(/^http:/, 'https:'))).toMatchObject({ ok: false, detail: 'The proxy answered 403 to the tunnel request.' });
    const gone = await startRecordingProxy({ auth: UP });
    await gone.close();
    const f = await forwarder(gone);
    expect(await checkProxy(session(f), s.url.replace(/^http:/, 'https:'))).toMatchObject({ ok: false, detail: 'The proxy answered 502 to the tunnel request.' });
    expect(await getThrough(f, s.url, basic(f.username, f.password))).toBe(502);
    expect(s.seen).toEqual([]);
  });

  it('closes: nothing is listening on its port afterwards, and the count goes back', async () => {
    const up = await upstream();
    const before = activeProxyForwarders();
    const f = await startProxyForwarder({ server: up.url, ...UP });
    expect(activeProxyForwarders()).toBe(before + 1);
    await f.close();
    expect(activeProxyForwarders()).toBe(before);
    const err = await new Promise<string>((resolve) => {
      const sock = connect(f.port, '127.0.0.1', () => { sock.destroy(); resolve('connected'); });
      sock.on('error', (e: Error & { code?: string }) => resolve(e.code ?? 'error'));
    });
    expect(err).toBe('ECONNREFUSED');
  });

  it('never logs either credential', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m));
    try {
      const up = await upstream();
      const s = await site();
      const f = await forwarder(up);
      await getThrough(f, s.url, basic(f.username, f.password));
      await getThrough(f, s.url);
      await checkProxy(session(f), s.url.replace(/^http:/, 'https:'));
      const bad = await forwarder(up, 'wrong');
      await checkProxy(session(bad), s.url.replace(/^http:/, 'https:'));
      expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    } finally { for (const spy of spies) spy.mockRestore(); }
  });

  it('a socks5 upstream with a password is refused at start', async () => {
    await expect(startProxyForwarder({ server: 'socks5://gate.invalid:1080', ...UP })).rejects.toThrow('A socks5 proxy with a password is not supported.');
  });
});
