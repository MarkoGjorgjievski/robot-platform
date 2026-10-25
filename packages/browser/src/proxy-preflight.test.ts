// The Node-side proxy check (spec 2026-10-24 proxy §2.2; Task 2 review, issue 1): loopback only, no Chromium.
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { createServer, type Server, type AddressInfo, type Socket } from 'node:net';
import { checkProxy } from './proxy-preflight.js';
import { startRecordingProxy, type RecordingProxy } from './__fixtures__/proxy.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { while (closers.length) await closers.pop()!(); });

async function proxy(opts?: Parameters<typeof startRecordingProxy>[0]): Promise<RecordingProxy> {
  const p = await startRecordingProxy(opts);
  closers.push(() => p.close());
  return p;
}
async function tcp(onSocket: (s: Socket) => void): Promise<number> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((s) => { sockets.add(s); onSocket(s); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  closers.push(() => new Promise<void>((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }));
  return (server.address() as AddressInfo).port;
}
async function site(status: number): Promise<string> {
  const s = http.createServer((_q, res) => { res.writeHead(status); res.end(); });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  closers.push(() => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); }));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}/p/1`;
}

describe('checkProxy', () => {
  it('https: a CONNECT with the right password passes; the proxy saw it, with the exact header', async () => {
    const p = await proxy({ auth: { username: 'u', password: 'p@ss:w/rd' } });
    const target = (await site(200)).replace(/^http:/, 'https:');
    expect(await checkProxy({ server: p.url, username: 'u', password: 'p@ss:w/rd' }, target)).toEqual({ ok: true });
    expect(p.log[0]).toMatchObject({ method: 'CONNECT', url: new URL(target).host, allowed: true });
  });

  it('https: a 407, and the detail names no credentials', async () => {
    const p = await proxy({ auth: { username: 'u', password: 'right' } });
    const r = await checkProxy({ server: p.url, username: 'secret-user', password: 'secret-pass' }, 'https://shop.invalid/p/1');
    expect(r).toEqual({ ok: false, detail: 'The proxy answered 407 (authentication required).' });
    expect(JSON.stringify(r)).not.toMatch(/secret/);
  });

  it('https: any answer but 200 to the CONNECT is the proxy failing', async () => {
    const port = await tcp((s) => s.once('data', () => s.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n')));
    expect(await checkProxy({ server: `http://127.0.0.1:${port}` }, 'https://shop.invalid/')).toEqual({ ok: false, detail: 'The proxy answered 502 to the tunnel request.' });
  });

  it('http: a 407 fails, the website’s own 404 through the proxy passes', async () => {
    const locked = await proxy({ auth: { username: 'u', password: 'p' } });
    expect(await checkProxy({ server: locked.url }, await site(404))).toMatchObject({ ok: false });
    const open = await proxy();
    const target = await site(404);
    expect(await checkProxy({ server: open.url }, target)).toEqual({ ok: true });
    expect(open.log[0]).toMatchObject({ method: 'HEAD', url: target });
  });

  it('a silent proxy fails within the timeout; a closed port and a dropped connection fail', async () => {
    const silent = await tcp(() => {});
    const t0 = Date.now();
    expect(await checkProxy({ server: `http://127.0.0.1:${silent}` }, 'https://shop.invalid/', 300)).toMatchObject({ ok: false });
    expect(Date.now() - t0).toBeLessThan(2000);
    const gone = await proxy();
    await gone.close();
    expect(await checkProxy({ server: gone.url }, 'https://shop.invalid/')).toMatchObject({ ok: false });
    const dropper = await tcp((s) => s.destroy());
    expect(await checkProxy({ server: `socks5://127.0.0.1:${dropper}` }, 'https://shop.invalid/')).toMatchObject({ ok: false });
  });

  it('socks5: a greeting and a CONNECT the proxy accepts pass; a refused CONNECT fails', async () => {
    const socks = (reply: number) => tcp((s) => {
      let stage = 0;
      s.on('data', () => { s.write(stage++ === 0 ? Buffer.from([5, 0]) : Buffer.from([5, reply, 0, 1, 0, 0, 0, 0, 0, 0])); });
    });
    expect(await checkProxy({ server: `socks5://127.0.0.1:${await socks(0)}` }, 'https://shop.invalid/')).toEqual({ ok: true });
    expect(await checkProxy({ server: `socks5://127.0.0.1:${await socks(5)}` }, 'https://shop.invalid/')).toMatchObject({ ok: false });
  });
});
