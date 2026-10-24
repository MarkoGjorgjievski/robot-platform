// packages/api/src/delivery/webhook-post.ts
// One webhook POST (spec 2026-10-24 §3.4): `node:http(s)` with a `lookup` that resolves the host once and refuses
// the private ranges if any address it returns is in them — the addresses it checked are the only ones handed to
// the connect, so a DNS answer that changes between a check and the connect cannot slip through. A literal address
// never reaches `lookup` and is checked before the request. No redirects (a 3xx is a failed delivery); one time
// limit for the whole request, answer included; the answer read up to a cap and discarded. Never rejects.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { hostIsPrivateLiteral, isPrivateAddress } from './webhook-url.js';

export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_MAX_RESPONSE_BYTES = 64 * 1024;
const PRIVATE = 'the address is a private or loopback network address';

/** The stored outcome of one attempt; `error` is staff-only text. */
export type PostResult = { ok: boolean; statusCode: number | null; error: string | null };
export type Resolve = (hostname: string, cb: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

const systemResolve: Resolve = (hostname, cb) => dnsLookup(hostname, { all: true }, cb);

function wantedFamily(family: unknown): 0 | 4 | 6 {
  if (family === 4 || family === 'IPv4') return 4;
  if (family === 6 || family === 'IPv6') return 6;
  return 0;
}

/**
 * A `lookup` for `net.connect`: resolves the name, refuses if any address it got back is private (whatever family
 * the connect asked for), and answers with those same addresses only.
 */
export function checkingLookup(allowPrivate: boolean, resolve: Resolve = systemResolve): LookupFunction {
  return (hostname, options, callback) => {
    let answered = false;
    const once: typeof callback = (err, address, family) => { if (answered) return; answered = true; callback(err, address, family); };
    try {
      resolve(hostname, (err, addresses) => {
        if (err) return once(err, '', 0);
        const all = Array.isArray(addresses) ? addresses : [];
        if (!allowPrivate && all.some((a) => isPrivateAddress(a?.address))) {
          return once(Object.assign(new Error(PRIVATE), { code: 'EPRIVATE' }), '', 0);
        }
        const want = wantedFamily(options.family);
        const list = all.filter((a) => !want || a.family === want).map((a) => ({ address: a.address, family: a.family }));
        if (list.length === 0) return once(Object.assign(new Error(`${hostname} has no address`), { code: 'ENOTFOUND' }), '', 0);
        if (options.all) return once(null, list);
        once(null, list[0]!.address, list[0]!.family);
      });
    } catch (err) {
      once(err as NodeJS.ErrnoException, '', 0);
    }
  };
}

export async function postWebhook(
  url: string,
  body: string,
  headers: Record<string, string>,
  opts: { allowPrivate?: boolean; timeoutMs?: number; maxBytes?: number; resolve?: Resolve } = {},
): Promise<PostResult> {
  const allowPrivate = opts.allowPrivate ?? false;
  const timeoutMs = opts.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? WEBHOOK_MAX_RESPONSE_BYTES;
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, statusCode: null, error: 'not a valid address' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, statusCode: null, error: 'not an http or https address' };
  if (u.username || u.password) return { ok: false, statusCode: null, error: 'the address carries a user name or password' };
  // A literal address never goes through `lookup`: it is checked here.
  if (!allowPrivate && hostIsPrivateLiteral(u.hostname)) return { ok: false, statusCode: null, error: PRIVATE };
  const send = u.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<PostResult>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (r: PostResult) => { if (settled) return; settled = true; clearTimeout(timer); resolve(r); };
    let req: ReturnType<typeof httpRequest>;
    try {
      req = send(u, {
        method: 'POST',
        headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
        lookup: checkingLookup(allowPrivate, opts.resolve),
        agent: false,
      }, (res) => {
        const status = res.statusCode ?? 0;
        let read = 0;
        const finish = () => done(
          status >= 200 && status < 300 ? { ok: true, statusCode: status, error: null }
          : status >= 300 && status < 400 ? { ok: false, statusCode: status, error: 'answered with a redirect, which is not followed' }
          : { ok: false, statusCode: status, error: `answered ${status}` },
        );
        res.on('data', (chunk: Buffer) => { read += chunk.length; if (read >= maxBytes) { finish(); res.destroy(); } });
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', finish);
      });
    } catch (err) {
      done({ ok: false, statusCode: null, error: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
      return;
    }
    timer = setTimeout(() => {
      done({ ok: false, statusCode: null, error: `no answer within ${Math.round(timeoutMs / 100) / 10} s` });
      req.destroy();
    }, timeoutMs);
    req.on('error', (err) => done({ ok: false, statusCode: null, error: (err.message || String(err)).slice(0, 500) }));
    req.end(body);
  });
}
