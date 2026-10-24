// packages/api/src/delivery/webhook-url.ts
// Which addresses a webhook may go to (spec 2026-10-24 §3.4 "Safety"): http or https, no credentials, at most
// 2,000 characters, and never loopback, private, link-local, CGNAT, multicast, reserved or unspecified — IPv4 and
// IPv6, including every IPv6 form that carries an IPv4 address (v4-mapped, v4-compatible, v4-translated, NAT64,
// 6to4), which is judged by the IPv4 address inside it. A name is checked again at send time against what it
// resolves to (webhook-post.ts). `WEBHOOK_ALLOW_PRIVATE=on` lifts the range check (tests, the local live check,
// Docker). Pure.
import { BlockList, isIP } from 'node:net';

export const PUBLIC_ADDRESS_MESSAGE = 'Use a public web address.';
export const WEBHOOK_URL_MAX = 2000;
const FULL_ADDRESS = 'Enter the full web address, starting with http or https.';
const TOO_LONG = 'Use a web address of at most 2,000 characters.';

const blockedV4 = new BlockList();
const blockedV6 = new BlockList();
const V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network", unspecified
  ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata)
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], // reserved
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
];
const V6: Array<[string, number]> = [
  ['::', 96], // unspecified, loopback, v4-compatible
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard
  ['2001::', 23], // IETF protocol assignments (Teredo, benchmarking, ORCHID)
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local
  ['ff00::', 8], // multicast
];
for (const [net, bits] of V4) blockedV4.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of V6) blockedV6.addSubnet(net, bits, 'ipv6');

/** An IPv6 address as its eight 16-bit groups, read by the WHATWG parser; null when it is not one. */
function hextets(ip: string): number[] | null {
  let canonical: string;
  try { canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1); } catch { return null; }
  const [head = '', tail] = canonical.split('::');
  const part = (s: string) => (s === '' ? [] : s.split(':').map((g) => parseInt(g, 16)));
  const a = part(head);
  const b = tail === undefined ? [] : part(tail);
  const groups = tail === undefined ? a : [...a, ...Array<number>(8 - a.length - b.length).fill(0), ...b];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

const v4From = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
const zero = (h: number[], from: number, to: number) => h.slice(from, to).every((g) => g === 0);

/** The IPv4 address an IPv6 address carries and is delivered to; null when it carries none. */
function embeddedV4(h: number[]): string | null {
  if (zero(h, 0, 5) && h[5] === 0xffff) return v4From(h[6]!, h[7]!); // ::ffff:a.b.c.d, v4-mapped
  if (zero(h, 0, 4) && h[4] === 0xffff && h[5] === 0) return v4From(h[6]!, h[7]!); // ::ffff:0:a.b.c.d, v4-translated
  if (h[0] === 0x64 && h[1] === 0xff9b && zero(h, 2, 6)) return v4From(h[6]!, h[7]!); // 64:ff9b::a.b.c.d, NAT64
  if (h[0] === 0x2002) return v4From(h[1]!, h[2]!); // 2002:aabb:ccdd::, 6to4
  return null;
}

/** True for an address no webhook may reach; anything that is not a plain address is refused too. */
export function isPrivateAddress(ip: string): boolean {
  if (typeof ip !== 'string' || ip.includes('%')) return true; // a zone id: link-local by nature, and BlockList misreads it
  try {
    const kind = isIP(ip);
    if (kind === 4) return blockedV4.check(ip, 'ipv4');
    if (kind === 6) {
      const h = hextets(ip);
      if (!h) return true;
      const v4 = embeddedV4(h);
      if (v4) return blockedV4.check(v4, 'ipv4');
      return blockedV6.check(h.map((g) => g.toString(16)).join(':'), 'ipv6');
    }
  } catch { /* an address BlockList cannot read: refused */ }
  return true;
}

/**
 * A URL hostname (or a raw host) that is `localhost` or a literal address in those ranges, in any spelling the
 * WHATWG parser accepts (`2130706433`, `0x7f.1`, `127.1`, a trailing dot, brackets). A name is the lookup's to
 * check; something that is neither a name nor an address is refused.
 */
export function hostIsPrivateLiteral(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (h === '') return true;
  const bracketed = /^\[(.*)\]$/.exec(h);
  if (bracketed || h.includes(':')) {
    const inner = (bracketed ? bracketed[1]! : h).replace(/%25/g, '%');
    return isIP(inner) === 6 ? isPrivateAddress(inner) : true;
  }
  if (/[\s/\\@?#]/.test(h)) return true;
  let normal: string;
  try { normal = new URL(`http://${h}/`).hostname; } catch { return true; }
  normal = normal.replace(/\.+$/, '');
  if (normal === '' || normal === 'localhost' || normal.endsWith('.localhost')) return true;
  return isIP(normal) !== 0 && isPrivateAddress(normal);
}

export function webhookPrivateAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return (env.WEBHOOK_ALLOW_PRIVATE ?? '').trim().toLowerCase() === 'on';
}

/** The address as it is stored (WHATWG-normalised), or the one sentence a customer reads. */
export function checkWebhookUrl(raw: string, opts: { allowPrivate?: boolean } = {}): { ok: true; url: string } | { ok: false; message: string } {
  const text = raw.trim();
  if (text === '') return { ok: false, message: 'Enter a web address.' };
  if (text.length > WEBHOOK_URL_MAX) return { ok: false, message: TOO_LONG };
  let u: URL;
  try { u = new URL(text); } catch { return { ok: false, message: FULL_ADDRESS }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, message: FULL_ADDRESS };
  if (u.username || u.password) return { ok: false, message: 'Leave the user name and password out of the address.' };
  if (!opts.allowPrivate && hostIsPrivateLiteral(u.hostname)) return { ok: false, message: PUBLIC_ADDRESS_MESSAGE };
  const url = u.toString();
  if (url.length > WEBHOOK_URL_MAX) return { ok: false, message: TOO_LONG };
  return { ok: true, url };
}
