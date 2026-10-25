// The recording proxy itself (Task 2 review, minor 7): it tunnels to an IPv6 loopback, and it carries nothing to a
// host off this machine, so no test can reach the internet through it.
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { startRecordingProxy, type RecordingProxy } from './__fixtures__/proxy.js';
import { checkProxy } from './proxy-preflight.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { while (closers.length) await closers.pop()!(); });
async function proxy(): Promise<RecordingProxy> {
  const p = await startRecordingProxy();
  closers.push(() => p.close());
  return p;
}
/** An absolute-URI GET through the proxy; the answer's status. */
function getThrough(p: RecordingProxy, url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: p.port, path: url, method: 'GET', headers: { host: new URL(url).host } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject);
    req.end();
  });
}

describe('startRecordingProxy', () => {
  it('tunnels a CONNECT to [::1]:port', async () => {
    const site = http.createServer((_q, res) => res.end('ok'));
    await new Promise<void>((r) => site.listen(0, '::1', () => r()));
    closers.push(() => new Promise<void>((r) => { site.closeAllConnections(); site.close(() => r()); }));
    const port = (site.address() as AddressInfo).port;
    const p = await proxy();
    expect(await checkProxy({ server: p.url }, `https://[::1]:${port}/p/1`)).toEqual({ ok: true });
    expect(p.log[0]).toMatchObject({ method: 'CONNECT', url: `[::1]:${port}` });
  });

  it('carries nothing off this machine: a CONNECT or a GET to another host is answered 403, never dialled', async () => {
    const p = await proxy();
    expect(await checkProxy({ server: p.url }, 'https://example.com/')).toEqual({ ok: false, detail: 'The proxy answered 403 to the tunnel request.', lasting: true });
    expect(await getThrough(p, 'http://example.com/')).toBe(403);
    expect(p.log.map((e) => e.method)).toEqual(['CONNECT', 'GET']);
  });
});
