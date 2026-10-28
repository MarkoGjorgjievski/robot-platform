// packages/api/src/proxy/fallback.ts
// The fallback route (spec 2026-10-28 turned away §3.3): when a website walls the direct route, a later try may load
// it through FALLBACK_PROXY_URL — available only for a website that has no other route (no own address, no
// DEFAULT_PROXY_URL), is not already on it, and has a country when the address fills one in. A fallback try that
// reads the page keeps the route for the website (`markFallbackKept`).
import { and, eq, isNull, sql } from 'drizzle-orm';
import { countryByCode } from '@robot/browser';
import { db, sources, type Database } from '@robot/db';
import { checkProxyUrl, COUNTRY_TOKEN } from './proxy-url.js';

/** FALLBACK_PROXY_URL, trimmed; null when blank or unset. */
export function fallbackProxyUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env.FALLBACK_PROXY_URL?.trim();
  return v ? v : null;
}

const known = (code: string | undefined | null): string | null => countryByCode(code)?.code ?? null;

/**
 * The country an address names (spec §3.3 "Country"): a first path segment `xx` or `xx-yy` / `xx_yy` whose first
 * part is a known country code (`/de-de/` → de), else the host's country-code TLD (`.de`, `.co.uk` / `.uk` → gb,
 * `.com.au` → au). Only codes in `@robot/browser`'s COUNTRIES; anything else is null.
 */
export function guessCountry(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const first = u.pathname.split('/').find((s) => s !== '') ?? '';
  const m = /^([a-z]{2})(?:[-_][a-z]{2})?$/i.exec(first);
  const fromPath = m ? known(m[1]) : null;
  if (fromPath) return fromPath;
  const tld = u.hostname.toLowerCase().split('.').pop() ?? '';
  if (!/^[a-z]{2}$/.test(tld)) return null;
  return known(tld === 'uk' ? 'gb' : tld);
}

export type FallbackSite = { proxyUrl: string | null; country: string | null; fallbackProxyAt: Date | null };
export type FallbackAvailability =
  | { available: true; country: string | null }
  | { available: false; reason: 'none' | 'own' | 'default' | 'already' | 'no-country' | 'unusable' };

/** Whether a try of `url` for this website may go by the fallback route, and the country it uses (spec §3.3 "Available"). */
export function fallbackFor(site: FallbackSite, url: string, env: NodeJS.ProcessEnv = process.env): FallbackAvailability {
  const fallback = fallbackProxyUrl(env);
  if (!fallback) return { available: false, reason: 'none' };
  if (site.proxyUrl?.trim()) return { available: false, reason: 'own' };
  if (env.DEFAULT_PROXY_URL?.trim()) return { available: false, reason: 'default' };
  if (site.fallbackProxyAt) return { available: false, reason: 'already' };
  if (!checkProxyUrl(fallback).ok) return { available: false, reason: 'unusable' };
  const country = known(site.country) ?? guessCountry(url);
  if (fallback.includes(COUNTRY_TOKEN) && !country) return { available: false, reason: 'no-country' };
  return { available: true, country };
}

/**
 * A fallback try read the page (spec §3.3 "Kept when it works"): the website keeps the fallback route from now on,
 * and the country the try used if it had none. Fenced on no fallback kept yet and no own address, so it happens once
 * and never over an address staff set meanwhile. True when this call kept it.
 */
export async function markFallbackKept(sourceId: string, country: string | null, database: Database = db): Promise<boolean> {
  const code = known(country);
  const updated = await database.update(sources)
    .set({ fallbackProxyAt: sql`now()`, country: code ? sql`COALESCE(${sources.country}, ${code})` : sql`${sources.country}` })
    .where(and(eq(sources.id, sourceId), isNull(sources.fallbackProxyAt), isNull(sources.proxyUrl)))
    .returning({ id: sources.id });
  return updated.length > 0;
}
