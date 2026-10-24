import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { clientIpOf } from './client-ip.js';

const socket = (remoteAddress: string) => ({ incoming: { socket: { remoteAddress } } });
// `app.request` may answer synchronously (a Response, not a Promise), so it is awaited, not chained.
async function ipOf(env: Record<string, string | undefined>, headers: Record<string, string> = {}, bindings?: unknown) {
  const app = new Hono().get('/ip', (c) => c.text(clientIpOf(c, env)));
  return (await app.request('/ip', { headers }, bindings as never)).text();
}

describe('the client address (spec 2026-10-24 tenant isolation §2.4)', () => {
  it('is the socket address, whatever X-Forwarded-For says, unless TRUST_PROXY=on', async () => {
    expect(await ipOf({}, { 'x-forwarded-for': '6.6.6.6' }, socket('10.0.0.5'))).toBe('10.0.0.5');
    expect(await ipOf({ TRUST_PROXY: 'off' }, { 'x-forwarded-for': '6.6.6.6' }, socket('10.0.0.5'))).toBe('10.0.0.5');
  });

  it('behind a trusted proxy, the last X-Forwarded-For entry — the address the proxy saw', async () => {
    expect(await ipOf({ TRUST_PROXY: 'on' }, { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }, socket('10.0.0.5'))).toBe('203.0.113.7');
    expect(await ipOf({ TRUST_PROXY: ' ON ' }, { 'x-forwarded-for': ' 203.0.113.7 ' }, socket('10.0.0.5'))).toBe('203.0.113.7');
    expect(await ipOf({ TRUST_PROXY: 'on' }, {}, socket('10.0.0.5'))).toBe('10.0.0.5');
  });

  it('is "unknown" with no socket (an in-process request)', async () => {
    expect(await ipOf({})).toBe('unknown');
  });
});
