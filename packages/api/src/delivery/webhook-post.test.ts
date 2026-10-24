// Spec 2026-10-24 §3.4 "Safety", when sending: one POST, no redirects, a time limit, a read cap, and an address
// check on what the name resolves to. Local servers on 127.0.0.1 only.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { LookupAddress } from 'node:dns';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, afterEach } from 'vitest';
import { checkingLookup, postWebhook, type Resolve } from './webhook-post.js';

type Received = { method: string; headers: IncomingMessage['headers']; body: string };
const servers: Array<{ close(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => s.close())); });

async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => { body += c; });
    req.on('end', () => { received.push({ method: req.method ?? '', headers: req.headers, body }); handler(req, res); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const handle = {
    port, url: `http://127.0.0.1:${port}/hook`, received,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
  servers.push(handle);
  return handle;
}
const to = (address: string): Resolve => (_h, cb) => cb(null, [{ address, family: address.includes(':') ? 6 : 4 }]);

describe('postWebhook', () => {
  it('posts the body with the headers given; a 2xx is delivered', async () => {
    const s = await serve((_q, res) => res.writeHead(204).end());
    const r = await postWebhook(s.url, '{"x":1}', { 'Content-Type': 'application/json', 'X-Robot-Event': 'run.finished' }, { allowPrivate: true });
    expect(r).toEqual({ ok: true, statusCode: 204, error: null });
    expect(s.received).toMatchObject([{ method: 'POST', body: '{"x":1}', headers: { 'content-type': 'application/json', 'x-robot-event': 'run.finished', 'content-length': '7' } }]);
  });
  it('a 500 is a failed attempt with its code', async () => {
    const s = await serve((_q, res) => res.writeHead(500).end('nope'));
    expect(await postWebhook(s.url, '{}', {}, { allowPrivate: true })).toMatchObject({ ok: false, statusCode: 500 });
  });
  it('RF1: a redirect is a failed delivery and is never followed', async () => {
    const inner = await serve((_q, res) => res.writeHead(200).end());
    const outer = await serve((_q, res) => res.writeHead(302, { Location: inner.url }).end());
    const r = await postWebhook(outer.url, '{}', {}, { allowPrivate: true });
    expect(r).toMatchObject({ ok: false, statusCode: 302 });
    expect(inner.received).toHaveLength(0);
  });
  it('RF1: a 307 that would replay the POST is not followed either', async () => {
    const inner = await serve((_q, res) => res.writeHead(200).end());
    const outer = await serve((_q, res) => res.writeHead(307, { Location: inner.url }).end());
    expect(await postWebhook(outer.url, '{}', {}, { allowPrivate: true })).toMatchObject({ ok: false, statusCode: 307 });
    expect(inner.received).toHaveLength(0);
  });
  it('RF3: a receiver that never answers fails at the timeout', async () => {
    const s = await serve(() => { /* never answers */ });
    const t0 = Date.now();
    const r = await postWebhook(s.url, '{}', {}, { allowPrivate: true, timeoutMs: 300 });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r).toMatchObject({ ok: false, statusCode: null });
    expect(r.error).toMatch(/no answer within/);
  });
  it('RF3: an endless 2xx body is read up to the cap, and the delivery counts', async () => {
    const s = await serve((_q, res) => {
      res.writeHead(200);
      const timer = setInterval(() => { if (!res.destroyed) res.write('x'.repeat(512)); else clearInterval(timer); }, 2);
      res.on('close', () => clearInterval(timer));
    });
    const t0 = Date.now();
    const r = await postWebhook(s.url, '{}', {}, { allowPrivate: true, maxBytes: 4096, timeoutMs: 5000 });
    expect(r).toEqual({ ok: true, statusCode: 200, error: null });
    expect(Date.now() - t0).toBeLessThan(4000);
  });
  it('RF3: a slow-dripping body is cut at the time limit, not read forever', async () => {
    const s = await serve((_q, res) => {
      res.writeHead(200);
      const timer = setInterval(() => { if (!res.destroyed) res.write('x'); else clearInterval(timer); }, 50);
      res.on('close', () => clearInterval(timer));
    });
    const t0 = Date.now();
    const r = await postWebhook(s.url, '{}', {}, { allowPrivate: true, timeoutMs: 400 });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r).toMatchObject({ ok: false, statusCode: null });
  });
  it('refuses a loopback literal without the flag; the server never sees it', async () => {
    const s = await serve((_q, res) => res.writeHead(200).end());
    const r = await postWebhook(s.url, '{}', {});
    expect(r).toMatchObject({ ok: false, statusCode: null });
    expect(r.error).toMatch(/private/);
    expect(s.received).toHaveLength(0);
  });
  it('refuses every other spelling of loopback without the flag; the server never sees them', async () => {
    const s = await serve((_q, res) => res.writeHead(200).end());
    for (const host of ['localhost', 'LOCALHOST.', '2130706433', '0x7f.1', '0177.0.0.1', '127.1', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[::1]', '0']) {
      const r = await postWebhook(`http://${host}:${s.port}/hook`, '{}', {});
      expect(r, host).toMatchObject({ ok: false, statusCode: null });
      expect(r.error, host).toMatch(/private/);
    }
    expect(s.received).toHaveLength(0);
  });
  it('refuses credentials in the address', async () => {
    const s = await serve((_q, res) => res.writeHead(200).end());
    const r = await postWebhook(`http://user:pw@127.0.0.1:${s.port}/hook`, '{}', {}, { allowPrivate: true });
    expect(r).toMatchObject({ ok: false, statusCode: null });
    expect(s.received).toHaveLength(0);
  });
  it('RF2: a name that resolves to a private address is refused at connect', async () => {
    const s = await serve((_q, res) => res.writeHead(200).end());
    const r = await postWebhook(`http://hooks.test:${s.port}/hook`, '{}', {}, { resolve: to('127.0.0.1') });
    expect(r).toMatchObject({ ok: false, statusCode: null });
    expect(r.error).toMatch(/private/);
    expect(s.received).toHaveLength(0);
  });
  it('RF2: a name that resolves to a v4-mapped or NAT64 loopback is refused at connect', async () => {
    const s = await serve((_q, res) => res.writeHead(200).end());
    for (const address of ['::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1', 'fe80::1%1', 'not-an-address']) {
      const r = await postWebhook(`http://hooks.test:${s.port}/hook`, '{}', {}, { resolve: to(address) });
      expect(r, address).toMatchObject({ ok: false, statusCode: null });
      expect(r.error, address).toMatch(/private/);
    }
    expect(s.received).toHaveLength(0);
  });
  it('RF2: one private address among public ones is enough to refuse', async () => {
    const both: Resolve = (_h, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }]);
    const r = await postWebhook('http://hooks.test:9/hook', '{}', {}, { resolve: both, timeoutMs: 2000 });
    expect(r).toMatchObject({ ok: false, statusCode: null });
    expect(r.error).toMatch(/private/);
  });
  it('with the flag, the address the lookup checked is the one it connects to', async () => {
    const s = await serve((_q, res) => res.writeHead(200).end());
    const r = await postWebhook(`http://hooks.test:${s.port}/hook`, '{}', {}, { allowPrivate: true, resolve: to('127.0.0.1') });
    expect(r.ok).toBe(true);
    expect(s.received).toHaveLength(1);
    expect(s.received[0]!.headers.host).toBe(`hooks.test:${s.port}`);
  });
  it('the resolver is asked once per attempt, so a changed DNS answer cannot slip in after the check', async () => {
    const s = await serve((_q, res) => res.writeHead(200).end());
    let calls = 0;
    const flip: Resolve = (_h, cb) => { calls += 1; cb(null, [{ address: calls === 1 ? '127.0.0.1' : '10.9.9.9', family: 4 }]); };
    const r = await postWebhook(`http://hooks.test:${s.port}/hook`, '{}', {}, { allowPrivate: true, resolve: flip });
    expect(r.ok).toBe(true);
    expect(calls).toBe(1);
  });
  it('a resolver error is a failed attempt', async () => {
    const fail: Resolve = (_h, cb) => cb(Object.assign(new Error('getaddrinfo ENOTFOUND hooks.test'), { code: 'ENOTFOUND' }), []);
    expect(await postWebhook('http://hooks.test/hook', '{}', {}, { resolve: fail })).toMatchObject({ ok: false, statusCode: null });
  });
  it('a closed port or a bad address is a failed attempt, never a throw', async () => {
    const s = await serve((_q, res) => res.writeHead(200).end());
    const port = s.port;
    await servers.pop()!.close();
    expect(await postWebhook(`http://127.0.0.1:${port}/hook`, '{}', {}, { allowPrivate: true })).toMatchObject({ ok: false, statusCode: null });
    expect(await postWebhook('not a url', '{}', {})).toMatchObject({ ok: false, statusCode: null });
    expect(await postWebhook('ftp://hooks.test/x', '{}', {})).toMatchObject({ ok: false, statusCode: null });
  });
  it('a header value that cannot be sent is a failed attempt, never a throw', async () => {
    const s = await serve((_q, res) => res.writeHead(200).end());
    expect(await postWebhook(s.url, '{}', { 'X-Bad': 'a\r\nInjected: 1' }, { allowPrivate: true })).toMatchObject({ ok: false, statusCode: null });
    expect(s.received).toHaveLength(0);
  });
});

describe('checkingLookup', () => {
  const run = (lookup: ReturnType<typeof checkingLookup>, options: Parameters<ReturnType<typeof checkingLookup>>[1]) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address: string | LookupAddress[]; family?: number }>((r) =>
      lookup('hooks.test', options, (err, address, family) => r({ err, address, family })));
  const mixed: Resolve = (_h, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '::1', family: 6 }]);

  it('refuses when any address is private, even one of a family not asked for', async () => {
    expect((await run(checkingLookup(false, mixed), { family: 4 })).err?.code).toBe('EPRIVATE');
    expect((await run(checkingLookup(false, mixed), { family: 'IPv4', all: true })).err?.code).toBe('EPRIVATE');
  });
  it('hands back only the addresses it checked, in the shape asked for', async () => {
    const pub: Resolve = (_h, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '2606:4700::1111', family: 6 }]);
    expect(await run(checkingLookup(false, pub), { all: true })).toMatchObject({ err: null, address: [{ address: '93.184.216.34', family: 4 }, { address: '2606:4700::1111', family: 6 }] });
    expect(await run(checkingLookup(false, pub), { family: 6 })).toMatchObject({ err: null, address: '2606:4700::1111', family: 6 });
    expect(await run(checkingLookup(false, pub), { family: 'IPv4' })).toMatchObject({ err: null, address: '93.184.216.34', family: 4 });
  });
  it('an empty answer is not found', async () => {
    expect((await run(checkingLookup(false, (_h, cb) => cb(null, [])), {})).err?.code).toBe('ENOTFOUND');
  });
});
