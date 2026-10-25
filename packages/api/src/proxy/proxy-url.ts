// packages/api/src/proxy/proxy-url.ts
// A website's proxy address (spec 2026-10-24 proxy §2.1): http://, https:// or socks5://, optionally user:pass@, with
// `{country}` filled in at use. Checked at save in one staff sentence; the password is masked for staff (§2.3) and
// redacted from every log line and stored error (§3.2). Pure.
import type { ProxySettings } from '@robot/browser';

export const COUNTRY_TOKEN = '{country}';
export const PROXY_URL_MAX = 1000;
export const PROXY_URL_EXAMPLE = 'Use an address like http://user:pass@host:port.';
export const ONLY_COUNTRY_TOKEN = 'Only {country} can be filled in.';
/** Chromium takes no credentials for a socks5 proxy (Playwright refuses the context). */
export const SOCKS_NO_AUTH = 'A socks5 proxy cannot take a user and password here. Use http:// or https://, or socks5://host:port.';

export type ParsedProxy = { scheme: 'http' | 'https' | 'socks5'; host: string; port: number; username?: string; password?: string };

/** `scheme://[userinfo@]host:port[/]` — the userinfo runs to the LAST `@` (as WHATWG reads it), the port is explicit. */
const SHAPE = /^(https?|socks5):\/\/([^/?#]*)\/?$/i;
const HOST_PORT = /^(\[[0-9a-f:.]+\]|[^:@[\]]+):(\d{1,5})$/i;

const decode = (s: string): string | null => { try { return decodeURIComponent(s); } catch { return null; } };

/** The parts of an address with no `{country}` left in it; null when it is not one we can use. */
export function parseProxyUrl(url: string): ParsedProxy | null {
  const m = SHAPE.exec(url);
  if (!m) return null;
  const authority = m[2]!;
  const at = authority.lastIndexOf('@');
  const hp = HOST_PORT.exec(authority.slice(at + 1));
  if (!hp) return null;
  const port = Number(hp[2]);
  if (port < 1 || port > 65_535) return null;
  try { if (!new URL(url).hostname) return null; } catch { return null; }
  const out: ParsedProxy = { scheme: m[1]!.toLowerCase() as ParsedProxy['scheme'], host: hp[1]!, port };
  if (at >= 0) {
    const userinfo = authority.slice(0, at);
    const colon = userinfo.indexOf(':');
    const user = decode(colon >= 0 ? userinfo.slice(0, colon) : userinfo);
    const pass = colon >= 0 ? decode(userinfo.slice(colon + 1)) : undefined;
    if (user === null || pass === null) return null;
    if (user) out.username = user;
    if (pass !== undefined) out.password = pass;
  }
  return out;
}

/** The save-time check (spec §2.1): the scheme, a host and a port, ≤ 1,000 characters, `{country}` the only token, no whitespace. */
export function checkProxyUrl(raw: string): { ok: true; url: string } | { ok: false; message: string } {
  const url = raw.trim();
  if (url === '' || url.length > PROXY_URL_MAX || /\s/.test(url)) return { ok: false, message: PROXY_URL_EXAMPLE };
  if (/[{}]/.test(url.split(COUNTRY_TOKEN).join(''))) return { ok: false, message: ONLY_COUNTRY_TOKEN };
  const parsed = parseProxyUrl(url.split(COUNTRY_TOKEN).join('xx'));
  if (!parsed) return { ok: false, message: PROXY_URL_EXAMPLE };
  if (parsed.scheme === 'socks5' && (parsed.username !== undefined || parsed.password !== undefined)) return { ok: false, message: SOCKS_NO_AUTH };
  return { ok: true, url };
}

/** What Playwright gets (spec §2.2): `{country}` replaced lower-case; null when the address does not check or needs a country it has not got. */
export function proxySettingsFor(url: string, countryCode: string | null): ProxySettings | null {
  if (!checkProxyUrl(url).ok) return null;
  if (url.includes(COUNTRY_TOKEN) && !countryCode) return null;
  const parsed = parseProxyUrl(url.trim().split(COUNTRY_TOKEN).join((countryCode ?? '').toLowerCase()));
  if (!parsed) return null;
  return {
    server: `${parsed.scheme}://${parsed.host}:${parsed.port}`,
    ...(parsed.username !== undefined ? { username: parsed.username } : {}),
    ...(parsed.password !== undefined ? { password: parsed.password } : {}),
  };
}

/** For staff (spec §2.3): `http://user:•••@host:port` — the password never leaves the server. */
export function maskProxyUrl(url: string): string {
  // An address that does not check (a broken DEFAULT_PROXY_URL is never validated) may hide its password anywhere
  // before the last '@': mask all of it, never return it as typed (Task 5 review).
  if (!checkProxyUrl(url).ok) {
    const t = url.trim();
    const at = t.lastIndexOf('@');
    if (at < 0) return t;
    const scheme = /^[a-z0-9]+:\/\//i.exec(t)?.[0] ?? '';
    return `${scheme}•••@${t.slice(at + 1)}`;
  }
  const m = /^([a-z0-9]+:\/\/)([^/?#]*)(.*)$/i.exec(url.trim());
  if (!m) return url;
  const authority = m[2]!;
  const at = authority.lastIndexOf('@');
  if (at < 0) return url.trim();
  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(':');
  const user = colon >= 0 ? userinfo.slice(0, colon) : userinfo;
  return `${m[1]}${user}${colon >= 0 ? ':•••' : ''}@${authority.slice(at + 1)}${m[3]}`;
}

/** Every log line and stored error (spec §2.1 "Storage"): the userinfo of each proxy address becomes `***`. */
export function redactProxy(text: string): string {
  return text.replace(/\b(https?|socks5):\/\/[^\s/?#]*@/gi, (_m, scheme: string) => `${scheme}://***@`);
}
