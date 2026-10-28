// The fallback route (spec 2026-10-28 turned away §3.3): when it is available for a website, the country a try uses,
// and keeping it once a fallback try read the page.
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { COUNTRIES } from '@robot/browser';
import { db, sources } from '@robot/db';
import { signedInCaller } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { fallbackConfigured, fallbackFor, fallbackProxyUrl, guessCountry, markFallbackKept } from './fallback.js';

const FALLBACK = 'http://f-{country}:fsecret@fallback.proxy.test:9000';
const PLAIN = 'http://fallback.proxy.test:9000';
const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv;
const bare = { proxyUrl: null, country: null, fallbackProxyAt: null };

describe('fallbackProxyUrl', () => {
  it('is FALLBACK_PROXY_URL trimmed; blank or unset is none', () => {
    expect(fallbackProxyUrl(env({ FALLBACK_PROXY_URL: `  ${PLAIN} ` }))).toBe(PLAIN);
    expect(fallbackProxyUrl(env({ FALLBACK_PROXY_URL: '   ' }))).toBeNull();
    expect(fallbackProxyUrl(env({}))).toBeNull();
  });
});

describe('fallbackConfigured (spec §3.5)', () => {
  it('is true only for a set, usable address', () => {
    expect(fallbackConfigured(env({ FALLBACK_PROXY_URL: FALLBACK }))).toBe(true);
    expect(fallbackConfigured(env({ FALLBACK_PROXY_URL: PLAIN }))).toBe(true);
    expect(fallbackConfigured(env({}))).toBe(false);
    expect(fallbackConfigured(env({ FALLBACK_PROXY_URL: '  ' }))).toBe(false);
    expect(fallbackConfigured(env({ FALLBACK_PROXY_URL: 'ftp://gate.provider.com:21' }))).toBe(false);
  });
});

describe('guessCountry (spec §3.3 "Country")', () => {
  it('a first path segment that is a known country code, alone or as its first part', () => {
    expect(guessCountry('https://shop.example.com/de-de/p/1')).toBe('de');
    expect(guessCountry('https://shop.example.com/DE/p/1')).toBe('de');
    expect(guessCountry('https://shop.example.com/fr_fr/p/1')).toBe('fr');
    expect(guessCountry('https://shop.example.com/gb/en/p/1')).toBe('gb');
  });

  it('a code not in COUNTRIES is no guess from the path: /my/en/ falls through to the host', () => {
    expect(COUNTRIES.some((c) => c.code === 'my')).toBe(false);
    expect(guessCountry('https://shop.example.com/my/en/p/1')).toBeNull();
    expect(guessCountry('https://shop.example.de/my/en/p/1')).toBe('de');
    // A language-first segment is not a country.
    expect(guessCountry('https://shop.example.com/en-gb/p/1')).toBeNull();
    // A longer segment is not a code.
    expect(guessCountry('https://shop.example.com/products/1')).toBeNull();
  });

  it('else the host’s country-code TLD: .co.uk is gb, .com.au is au; only codes in COUNTRIES', () => {
    expect(guessCountry('https://www.shop.de/p/1')).toBe('de');
    expect(guessCountry('https://www.shop.co.uk/p/1')).toBe('gb');
    expect(guessCountry('https://www.shop.uk/p/1')).toBe('gb');
    expect(guessCountry('https://www.shop.com.au/p/1')).toBe('au');
    expect(guessCountry('https://www.shop.co.jp/p/1')).toBe('jp');
    expect(guessCountry('https://www.shop.com/p/1')).toBeNull();
    expect(guessCountry('https://www.shop.eu/p/1')).toBeNull();
    expect(guessCountry('https://www.shop.com.my/p/1')).toBeNull();
    expect(guessCountry('not a url')).toBeNull();
  });
});

describe('fallbackFor (spec §3.3 "Available")', () => {
  const url = 'https://www.shop.de/p/1';

  it('available: the env set and usable, no own address, no default, not already on it; the country stored or guessed', () => {
    expect(fallbackFor(bare, url, env({ FALLBACK_PROXY_URL: FALLBACK }))).toEqual({ available: true, country: 'de' });
    expect(fallbackFor({ ...bare, country: 'FR' }, url, env({ FALLBACK_PROXY_URL: FALLBACK }))).toEqual({ available: true, country: 'fr' });
    // No {country} in the address: available without a country.
    expect(fallbackFor(bare, 'https://www.shop.com/p/1', env({ FALLBACK_PROXY_URL: PLAIN }))).toEqual({ available: true, country: null });
  });

  it('a website on the default us takes the country its address names; another stored country is kept (ruling 2026-10-28)', () => {
    const e = env({ FALLBACK_PROXY_URL: FALLBACK });
    expect(fallbackFor({ ...bare, country: 'us' }, 'https://www.shop.com/de-de/p/1', e)).toEqual({ available: true, country: 'de' });
    expect(fallbackFor({ ...bare, country: 'US' }, 'https://www.shop.de/p/1', e)).toEqual({ available: true, country: 'de' });
    expect(fallbackFor({ ...bare, country: 'us' }, 'https://www.shop.com/p/1', e)).toEqual({ available: true, country: 'us' });
    expect(fallbackFor({ ...bare, country: 'fr' }, 'https://www.shop.com/de-de/p/1', e)).toEqual({ available: true, country: 'fr' });
  });

  it('not available, and why', () => {
    expect(fallbackFor(bare, url, env({}))).toEqual({ available: false, reason: 'none' });
    expect(fallbackFor(bare, url, env({ FALLBACK_PROXY_URL: ' ' }))).toEqual({ available: false, reason: 'none' });
    expect(fallbackFor({ ...bare, proxyUrl: 'http://own.proxy.test:7000' }, url, env({ FALLBACK_PROXY_URL: FALLBACK })))
      .toEqual({ available: false, reason: 'own' });
    expect(fallbackFor(bare, url, env({ FALLBACK_PROXY_URL: FALLBACK, DEFAULT_PROXY_URL: 'http://d.proxy.test:8000' })))
      .toEqual({ available: false, reason: 'default' });
    expect(fallbackFor({ ...bare, fallbackProxyAt: new Date() }, url, env({ FALLBACK_PROXY_URL: FALLBACK })))
      .toEqual({ available: false, reason: 'already' });
    expect(fallbackFor(bare, url, env({ FALLBACK_PROXY_URL: 'gate.provider.com:7000' }))).toEqual({ available: false, reason: 'unusable' });
    expect(fallbackFor(bare, 'https://www.shop.com/p/1', env({ FALLBACK_PROXY_URL: FALLBACK }))).toEqual({ available: false, reason: 'no-country' });
  });

  it('a blank own address or default is none', () => {
    expect(fallbackFor({ ...bare, proxyUrl: '  ' }, url, env({ FALLBACK_PROXY_URL: FALLBACK, DEFAULT_PROXY_URL: ' ' })))
      .toEqual({ available: true, country: 'de' });
  });
});

describe('markFallbackKept (spec §3.3 "Kept when it works")', () => {
  it('sets fallback_proxy_at and a missing country, once; fenced on no fallback yet and no own address', async () => {
    const me = await signedInCaller('fallback-kept');
    const site = await createProjectWithSource(me.caller, { tag: 'fallback-kept', fields: [{ name: 'Title', type: 'text' }] });
    const read = async () => (await db.query.sources.findFirst({ where: eq(sources.id, site.sourceId), columns: { fallbackProxyAt: true, country: true } }))!;
    try {
      await db.update(sources).set({ country: null }).where(eq(sources.id, site.sourceId));
      expect(await markFallbackKept(site.sourceId, 'de')).toBe(true);
      const kept = await read();
      expect(kept.fallbackProxyAt).toBeInstanceOf(Date);
      expect(kept.country).toBe('de');
      // Already kept: nothing changes.
      expect(await markFallbackKept(site.sourceId, 'fr')).toBe(false);
      expect(await read()).toEqual(kept);

      // A stored country is kept; a null country used leaves it as it is.
      await db.update(sources).set({ fallbackProxyAt: null, country: 'gb' }).where(eq(sources.id, site.sourceId));
      expect(await markFallbackKept(site.sourceId, 'de')).toBe(true);
      expect((await read()).country).toBe('gb');
      await db.update(sources).set({ fallbackProxyAt: null, country: null }).where(eq(sources.id, site.sourceId));
      expect(await markFallbackKept(site.sourceId, null)).toBe(true);
      expect((await read()).country).toBeNull();

      // The country used replaces the default us, never another stored country (ruling 2026-10-28).
      await db.update(sources).set({ fallbackProxyAt: null, country: 'us' }).where(eq(sources.id, site.sourceId));
      expect(await markFallbackKept(site.sourceId, 'de')).toBe(true);
      expect((await read()).country).toBe('de');
      await db.update(sources).set({ fallbackProxyAt: null, country: 'fr' }).where(eq(sources.id, site.sourceId));
      expect(await markFallbackKept(site.sourceId, 'de')).toBe(true);
      expect((await read()).country).toBe('fr');

      // An own address (set meanwhile by staff): never kept.
      await db.update(sources).set({ fallbackProxyAt: null, proxyUrl: 'http://own.proxy.test:7000' }).where(eq(sources.id, site.sourceId));
      expect(await markFallbackKept(site.sourceId, 'de')).toBe(false);
      expect((await read()).fallbackProxyAt).toBeNull();

      // An unknown website: nothing.
      expect(await markFallbackKept('00000000-0000-4000-8000-000000000000', 'de')).toBe(false);
    } finally {
      await site.cleanup();
      await me.cleanup();
    }
  });
});
