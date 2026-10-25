// packages/api/src/proxy/browser-profile.ts
// A website's browser (spec 2026-10-24 proxy §2.2): its own proxy address, else DEFAULT_PROXY_URL, with `{country}`
// filled in, and its country's locale and time zone. An address that cannot be used is a proxy failure — the capture
// fails with "The proxy refused the connection." and the staff reason — never a direct load (§3.1).
import { eq } from 'drizzle-orm';
import { CaptureError, countryByCode, type BrowserProfile } from '@robot/browser';
import { sources, type Database } from '@robot/db';
import { checkProxyUrl, COUNTRY_TOKEN, maskProxyUrl, proxySettingsFor, redactProxy } from './proxy-url.js';

export const NEEDS_COUNTRY = "This website's proxy address fills in {country}, so it needs a country.";

type Site = { proxyUrl: string | null; country: string | null };
const blank = (s: string | null | undefined) => !s || s.trim() === '';

/** The staff reason this website's address cannot be used, or null. */
function problemOf(own: string | null, fallback: string | null, hasCountry: boolean): string | null {
  const url = own ?? fallback;
  if (!url) return null;
  const where = own ? "This website's proxy address" : 'DEFAULT_PROXY_URL';
  const checked = checkProxyUrl(url);
  if (!checked.ok) return redactProxy(`${where} is not usable: ${checked.message}`);
  if (url.includes(COUNTRY_TOKEN) && !hasCountry) return own ? NEEDS_COUNTRY : 'DEFAULT_PROXY_URL fills in {country}, and this website has no country.';
  return null;
}

export function buildProfile(site: Site, defaultUrl: string | undefined = process.env.DEFAULT_PROXY_URL): BrowserProfile {
  const country = countryByCode(site.country);
  const profile: BrowserProfile = country ? { locale: country.locale, timezoneId: country.timezoneId } : {};
  const own = blank(site.proxyUrl) ? null : site.proxyUrl!.trim();
  const fallback = blank(defaultUrl) ? null : defaultUrl!.trim();
  const url = own ?? fallback;
  if (!url) return profile;
  const problem = problemOf(own, fallback, !!country);
  if (problem) throw new CaptureError('proxy', '', problem);
  return { ...profile, proxy: proxySettingsFor(url, country?.code ?? null)! };
}

export type Network = { proxy: 'own' | 'default' | 'none'; proxyUrl: string | null; country: string | null; countryName: string | null; problem: string | null };

/** What staff read (spec §2.3): own, the default or none, the address masked, the country, and why it cannot be used. */
export function networkOf(site: Site, defaultUrl: string | undefined = process.env.DEFAULT_PROXY_URL): Network {
  const country = countryByCode(site.country);
  const own = blank(site.proxyUrl) ? null : site.proxyUrl!.trim();
  const fallback = blank(defaultUrl) ? null : defaultUrl!.trim();
  const url = own ?? fallback;
  return {
    proxy: own ? 'own' : fallback ? 'default' : 'none',
    proxyUrl: url ? maskProxyUrl(url) : null,
    country: country?.code ?? null,
    countryName: country?.name ?? null,
    problem: problemOf(own, fallback, !!country),
  };
}

/** The profile a website's browser session opens with (spec §2.2). An unknown website: `{}` (direct, as before). */
export async function browserProfileForSource(db: Database, sourceId: string): Promise<BrowserProfile> {
  const row = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { proxyUrl: true, country: true } });
  return row ? buildProfile(row) : {};
}
