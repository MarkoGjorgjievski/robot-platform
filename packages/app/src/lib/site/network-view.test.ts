import { describe, expect, it } from 'vitest';
import {
  NETWORK_HELP, NETWORK_TITLE, NO_COUNTRY, countryChoices, countryFromChoice, proxySaveReason, proxyStateLine, useDefaultReason,
} from './network-view';

describe('the Network (staff) panel (spec 2026-10-24 proxy §2.3)', () => {
  it('says whose address the website uses, masked as the server sent it', () => {
    expect(NETWORK_TITLE).toBe('Network (staff)');
    expect(proxyStateLine({ proxyUrl: 'http://u:•••@gate.test:7000', proxyFromDefault: false })).toBe("This website's own: http://u:•••@gate.test:7000");
    expect(proxyStateLine({ proxyUrl: 'http://d:•••@default.test:8000', proxyFromDefault: true })).toBe('The default: http://d:•••@default.test:8000');
    expect(proxyStateLine({ proxyUrl: null, proxyFromDefault: false })).toBe('No proxy: pages load directly.');
  });

  it('says why Save and "Use the default" are off', () => {
    expect(proxySaveReason('')).toBe('Type a proxy address to save');
    expect(proxySaveReason('   ')).toBe('Type a proxy address to save');
    expect(proxySaveReason('http://gate.test:7000')).toBeNull();
    expect(useDefaultReason({ proxyUrl: 'http://gate.test:7000', proxyFromDefault: false })).toBeNull();
    expect(useDefaultReason({ proxyUrl: 'http://d@default.test:8000', proxyFromDefault: true })).toBe('This website has no address of its own');
    expect(useDefaultReason({ proxyUrl: null, proxyFromDefault: false })).toBe('This website has no address of its own');
  });

  it('offers No preference first, then the countries by name', () => {
    const choices = countryChoices([{ code: 'gb', name: 'United Kingdom' }, { code: 'de', name: 'Germany' }]);
    expect(choices).toEqual([{ value: NO_COUNTRY, label: 'No preference' }, { value: 'de', label: 'Germany' }, { value: 'gb', label: 'United Kingdom' }]);
    expect(countryFromChoice(NO_COUNTRY)).toBeNull();
    expect(countryFromChoice('de')).toBe('de');
  });

  it('notes what goes direct (spec §2.2)', () => {
    expect(NETWORK_HELP).toContain('go direct');
  });
});
