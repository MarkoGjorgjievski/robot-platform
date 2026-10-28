import { describe, expect, it } from 'vitest';
import {
  GO_DIRECT, NETWORK_HELP, NETWORK_TITLE, NO_COUNTRY, countryChoices, countryFromChoice, fallbackSwitchLine, proxySaveReason, proxyStateLine, useDefaultReason,
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

describe('the automatic fallback on the Network panel (spec 2026-10-28 §3.3 "Undo")', () => {
  it('reads the fallback as the website’s route, and "Use the default" stays off for it', () => {
    const n = { proxyUrl: 'http://f:•••@fallback.test:9000', proxyFromDefault: false, proxyFromFallback: true };
    expect(proxyStateLine(n)).toBe('The fallback, switched to automatically: http://f:•••@fallback.test:9000');
    expect(useDefaultReason(n)).toBe('This website has no address of its own');
  });

  it('says when the website switched, with "Go direct again"', () => {
    expect(fallbackSwitchLine(new Date('2026-10-27T09:30:00Z'))).toBe('Switched to the fallback proxy on 2026-10-27 after being turned away');
    expect(fallbackSwitchLine('2026-10-27T23:59:00Z')).toBe('Switched to the fallback proxy on 2026-10-27 after being turned away');
    expect(fallbackSwitchLine(null)).toBeNull();
    expect(GO_DIRECT).toBe('Go direct again');
  });
});
