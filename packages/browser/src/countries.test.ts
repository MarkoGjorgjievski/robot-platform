// The 20 markets a website can be read from (spec 2026-10-24 proxy §2.1): every locale a BCP-47 tag Intl keeps as is,
// every zone one Intl knows, every code unique, lower-case, and the region of its own locale.
import { describe, expect, it } from 'vitest';
import { COUNTRIES, countryByCode } from './countries.js';

describe('COUNTRIES (spec 2026-10-24 proxy §2.1)', () => {
  it('is twenty markets with unique lower-case codes', () => {
    expect(COUNTRIES).toHaveLength(20);
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(20);
    for (const c of COUNTRIES) expect(c.code).toMatch(/^[a-z]{2}$/);
  });

  it.each(COUNTRIES.map((c) => [c.code, c] as const))('%s has a canonical locale of its own region and a real time zone', (_code, c) => {
    expect(Intl.getCanonicalLocales(c.locale)[0]).toBe(c.locale);
    expect(c.locale.endsWith(`-${c.code.toUpperCase()}`)).toBe(true);
    expect(() => new Intl.DateTimeFormat('en', { timeZone: c.timezoneId })).not.toThrow();
    expect(new Intl.DateTimeFormat('en', { timeZone: c.timezoneId }).resolvedOptions().timeZone).toBe(c.timezoneId);
    expect(c.name.trim()).not.toBe('');
  });

  it('carries the spec’s three examples, and finds a code whatever its case', () => {
    expect(countryByCode('de')).toMatchObject({ locale: 'de-DE', timezoneId: 'Europe/Berlin', name: 'Germany' });
    expect(countryByCode('GB')).toMatchObject({ locale: 'en-GB', timezoneId: 'Europe/London' });
    expect(countryByCode('Us')).toMatchObject({ locale: 'en-US', timezoneId: 'America/New_York' });
    for (const none of [null, undefined, '', 'zz', 'deu']) expect(countryByCode(none)).toBeNull();
  });
});
