// A website's browser (spec 2026-10-24 proxy §2.2): its own address or the default, {country} filled in, its country's
// locale and time zone — and an address that cannot be used is a proxy failure, never a direct load (§3.1).
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { CaptureError } from '@robot/browser';
import { db, sources } from '@robot/db';
import { signedInCaller } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { browserProfileForSource, buildProfile, NEEDS_COUNTRY, networkOf } from './browser-profile.js';

const OWN = 'http://u-country-{country}:secret@own.proxy.test:7000';
const DEFAULT = 'http://d:dsecret@default.proxy.test:8000';
const failure = (f: () => unknown) => { try { f(); return null; } catch (e) { return e; } };

describe('buildProfile (spec §2.2)', () => {
  it('own address: {country} filled in, the country’s locale and zone', () => {
    expect(buildProfile({ proxyUrl: OWN, country: 'de' }, DEFAULT)).toEqual({
      proxy: { server: 'http://own.proxy.test:7000', username: 'u-country-de', password: 'secret' }, locale: 'de-DE', timezoneId: 'Europe/Berlin',
    });
  });

  it('no address of its own: the default; none at all: no proxy key', () => {
    expect(buildProfile({ proxyUrl: null, country: null }, DEFAULT)).toEqual({ proxy: { server: 'http://default.proxy.test:8000', username: 'd', password: 'dsecret' } });
    expect(buildProfile({ proxyUrl: null, country: null }, undefined)).toEqual({});
    expect(buildProfile({ proxyUrl: null, country: null }, '   ')).toEqual({});
  });

  it('a country and no proxy: locale and zone only; a proxy and no country: no locale, no zone (stealth’s defaults)', () => {
    expect(buildProfile({ proxyUrl: null, country: 'GB' }, undefined)).toEqual({ locale: 'en-GB', timezoneId: 'Europe/London' });
    expect(buildProfile({ proxyUrl: 'http://own.proxy.test:7000', country: null }, undefined)).toEqual({ proxy: { server: 'http://own.proxy.test:7000' } });
  });

  it('a country not in the table is no preference', () => {
    expect(buildProfile({ proxyUrl: null, country: 'zz' }, undefined)).toEqual({});
  });

  it('RF1: {country} with no country never guesses and never goes direct', () => {
    const own = failure(() => buildProfile({ proxyUrl: OWN, country: null }, undefined));
    expect(own).toBeInstanceOf(CaptureError);
    expect(own).toMatchObject({ kind: 'proxy', message: 'The proxy refused the connection.', detail: NEEDS_COUNTRY });
    const viaDefault = failure(() => buildProfile({ proxyUrl: null, country: null }, 'http://d-{country}:p@default.proxy.test:8000'));
    expect(viaDefault).toMatchObject({ kind: 'proxy', detail: 'DEFAULT_PROXY_URL fills in {country}, and this website has no country.' });
    expect(networkOf({ proxyUrl: null, country: null }, 'http://d-{country}:p@default.proxy.test:8000'))
      .toMatchObject({ proxy: 'default', problem: 'DEFAULT_PROXY_URL fills in {country}, and this website has no country.' });
  });

  it('RF2: a broken default is a problem for every website that uses it, never a direct load', () => {
    for (const bad of ['gate.provider.com:7000', 'http://gate.provider.com', 'socks5://u:p@gate.provider.com:1080', 'http://gate provider.com:7000']) {
      const err = failure(() => buildProfile({ proxyUrl: null, country: 'de' }, bad));
      expect(err).toMatchObject({ kind: 'proxy', message: 'The proxy refused the connection.' });
      expect((err as CaptureError).detail).toMatch(/^DEFAULT_PROXY_URL is not usable: /);
      expect((err as CaptureError).detail).not.toMatch(/u:p@/);
      expect(networkOf({ proxyUrl: null, country: 'de' }, bad).problem).toMatch(/^DEFAULT_PROXY_URL is not usable: /);
    }
    // A website with its own good address does not care about a broken default.
    expect(buildProfile({ proxyUrl: 'http://own.proxy.test:7000', country: null }, 'nonsense')).toEqual({ proxy: { server: 'http://own.proxy.test:7000' } });
  });
});

describe('networkOf (spec §2.3 "What sources.get returns", "Ops")', () => {
  it('own, default or none, the address masked, the country named', () => {
    expect(networkOf({ proxyUrl: OWN, country: 'de' }, DEFAULT)).toEqual({
      proxy: 'own', proxyUrl: 'http://u-country-{country}:•••@own.proxy.test:7000', country: 'de', countryName: 'Germany', problem: null,
    });
    expect(networkOf({ proxyUrl: null, country: 'US' }, DEFAULT)).toEqual({
      proxy: 'default', proxyUrl: 'http://d:•••@default.proxy.test:8000', country: 'us', countryName: 'United States', problem: null,
    });
    expect(networkOf({ proxyUrl: null, country: null }, undefined)).toEqual({ proxy: 'none', proxyUrl: null, country: null, countryName: null, problem: null });
  });
});

describe('browserProfileForSource (spec §2.2)', () => {
  const saved = process.env.DEFAULT_PROXY_URL;
  afterAll(() => { if (saved === undefined) delete process.env.DEFAULT_PROXY_URL; else process.env.DEFAULT_PROXY_URL = saved; });

  it('reads the website’s row and the env default; an unknown website loads as before', async () => {
    const me = await signedInCaller('proxy-profile');
    const site = await createProjectWithSource(me.caller, { tag: 'proxy-profile', fields: [{ name: 'Title', type: 'text' }] });
    try {
      delete process.env.DEFAULT_PROXY_URL;
      // A new website is still created with country 'us' (as today): stealth's own en-US / New York, no proxy.
      expect(await browserProfileForSource(db, site.sourceId)).toEqual({ locale: 'en-US', timezoneId: 'America/New_York' });
      await db.update(sources).set({ proxyUrl: OWN, country: 'de' }).where(eq(sources.id, site.sourceId));
      expect(await browserProfileForSource(db, site.sourceId)).toMatchObject({ proxy: { username: 'u-country-de' }, locale: 'de-DE' });
      await db.update(sources).set({ proxyUrl: null, country: null }).where(eq(sources.id, site.sourceId));
      process.env.DEFAULT_PROXY_URL = DEFAULT;
      expect(await browserProfileForSource(db, site.sourceId)).toEqual({ proxy: { server: 'http://default.proxy.test:8000', username: 'd', password: 'dsecret' } });
      expect(await browserProfileForSource(db, '00000000-0000-4000-8000-000000000000')).toEqual({});
    } finally {
      await site.cleanup();
      await me.cleanup();
    }
  });
});
