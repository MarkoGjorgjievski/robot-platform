// packages/api/src/proxy/browser-profile.ts
// A website's browser (spec 2026-10-24 proxy §2.2): its own proxy address, else DEFAULT_PROXY_URL, with `{country}`
// filled in, and its country's locale and time zone. An address that cannot be used is a proxy failure — the capture
// fails with "The proxy refused the connection." and the staff reason — never a direct load (§3.1).
// When a website turns us away (spec 2026-10-28 §3.3), FALLBACK_PROXY_URL comes after those two: for a website that
// kept it (`fallback_proxy_at`) while it is set, and for a try that asks for it (`via: 'fallback'`).
import { eq } from 'drizzle-orm';
import { CaptureError, countryByCode, type BrowserProfile } from '@robot/browser';
import { sources, type Database } from '@robot/db';
import { checkProxyUrl, COUNTRY_TOKEN, maskProxyUrl, proxySettingsFor, redactProxy } from './proxy-url.js';

export const NEEDS_COUNTRY = "This website's proxy address fills in {country}, so it needs a country.";
export const FALLBACK_NOT_SET = 'FALLBACK_PROXY_URL is not set.';

/** `fallbackProxyAt`: when the website kept the fallback route (spec 2026-10-28 §3.3); absent reads as none. */
type Site = { proxyUrl: string | null; country: string | null; fallbackProxyAt?: Date | null };
/** A try that goes by the fallback route, and the country it uses (spec 2026-10-28 §3.3). */
export type RouteOptions = { via?: 'fallback'; country?: string | null };
type Which = 'own' | 'default' | 'fallback';
const blank = (s: string | null | undefined) => !s || s.trim() === '';
const trimmed = (s: string | null | undefined) => (blank(s) ? null : s!.trim());
const NAME: Record<Which, string> = { own: "This website's proxy address", default: 'DEFAULT_PROXY_URL', fallback: 'FALLBACK_PROXY_URL' };

/** The staff reason this address cannot be used, or null. */
function problemOf(which: Which | null, url: string | null, hasCountry: boolean): string | null {
  if (!which || !url) return null;
  const checked = checkProxyUrl(url);
  if (!checked.ok) return redactProxy(`${NAME[which]} is not usable: ${checked.message}`);
  if (url.includes(COUNTRY_TOKEN) && !hasCountry) return which === 'own' ? NEEDS_COUNTRY : `${NAME[which]} fills in {country}, and this website has no country.`;
  return null;
}

/** Which address a website's browser uses: own → default → the fallback (kept or asked for) → none. */
function routeOf(site: Site, defaultUrl: string | undefined, fallbackUrl: string | undefined, opts: RouteOptions): { which: Which | null; url: string | null } {
  const own = trimmed(site.proxyUrl);
  if (own) return { which: 'own', url: own };
  const dflt = trimmed(defaultUrl);
  if (dflt) return { which: 'default', url: dflt };
  const fallback = trimmed(fallbackUrl);
  if (opts.via === 'fallback' || (site.fallbackProxyAt && fallback)) return { which: 'fallback', url: fallback };
  return { which: null, url: null };
}

export function buildProfile(
  site: Site,
  defaultUrl: string | undefined = process.env.DEFAULT_PROXY_URL,
  fallbackUrl: string | undefined = process.env.FALLBACK_PROXY_URL,
  opts: RouteOptions = {},
): BrowserProfile {
  const country = countryByCode(opts.country ?? site.country);
  const profile: BrowserProfile = country ? { locale: country.locale, timezoneId: country.timezoneId } : {};
  const { which, url } = routeOf(site, defaultUrl, fallbackUrl, opts);
  // A try asked for the fallback and there is none: a proxy failure, never a direct load under the fallback's name.
  if (which === 'fallback' && !url) throw new CaptureError('proxy', '', FALLBACK_NOT_SET);
  if (!url) return profile;
  const problem = problemOf(which, url, !!country);
  if (problem) throw new CaptureError('proxy', '', problem);
  return { ...profile, proxy: proxySettingsFor(url, country?.code ?? null)! };
}

export type Network = { proxy: 'own' | 'default' | 'fallback' | 'none'; proxyUrl: string | null; country: string | null; countryName: string | null; problem: string | null };

/** What staff read (spec §2.3): own, the default, the kept fallback or none, the address masked, the country, and why it cannot be used. */
export function networkOf(
  site: Site,
  defaultUrl: string | undefined = process.env.DEFAULT_PROXY_URL,
  fallbackUrl: string | undefined = process.env.FALLBACK_PROXY_URL,
): Network {
  const country = countryByCode(site.country);
  const { which, url } = routeOf(site, defaultUrl, fallbackUrl, {});
  return {
    proxy: which ?? 'none',
    proxyUrl: url ? maskProxyUrl(url) : null,
    country: country?.code ?? null,
    countryName: country?.name ?? null,
    problem: problemOf(which, url, !!country),
  };
}

/** The profile a website's browser session opens with (spec §2.2). An unknown website (deleted mid-job) is one with no
 *  address or country of its own: the default proxy when there is one, never direct because the row is gone. `opts`: a
 *  try by the fallback route (spec 2026-10-28 §3.3). */
export async function browserProfileForSource(db: Database, sourceId: string, opts: RouteOptions = {}): Promise<BrowserProfile> {
  const row = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { proxyUrl: true, country: true, fallbackProxyAt: true } });
  return buildProfile(row ?? { proxyUrl: null, country: null, fallbackProxyAt: null }, undefined, undefined, opts);
}
