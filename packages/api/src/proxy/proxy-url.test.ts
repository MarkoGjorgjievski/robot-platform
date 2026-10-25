// The proxy address (spec 2026-10-24 proxy §2.1): what is accepted at save, how {country} is filled in, and how the
// password is hidden — masked for staff, redacted from every log line and stored error.
import { describe, expect, it } from 'vitest';
import {
  checkProxyUrl, maskProxyUrl, ONLY_COUNTRY_TOKEN, parseProxyUrl, PROXY_URL_EXAMPLE, proxySettingsFor, redactProxy, SOCKS_NO_AUTH,
} from './proxy-url.js';

describe('checkProxyUrl (spec §2.1)', () => {
  it('takes the three schemes with a host and a port, with or without user:pass@ and {country}', () => {
    for (const url of [
      'http://gate.provider.com:7000', 'https://u:p@gate.provider.com:443', 'socks5://10.0.0.5:1080',
      'http://user-country-{country}:pass@gate.provider.com:7000', 'http://{country}.gate.provider.com:7000/',
      'http://u:p@[::1]:8080',
    ]) expect(checkProxyUrl(url)).toEqual({ ok: true, url });
    expect(checkProxyUrl('  http://gate.provider.com:7000  ')).toEqual({ ok: true, url: 'http://gate.provider.com:7000' });
  });

  it('refuses everything else in one staff sentence', () => {
    for (const bad of [
      '', 'gate.provider.com:7000', 'ftp://gate.provider.com:21', 'http://gate.provider.com', 'http://:7000',
      'http://gate.provider.com:0', 'http://gate.provider.com:70000', 'http://gate.provider.com:7000/path', 'http://gate.provider.com:7000?x=1',
      'http://gate provider.com:7000', 'http://u:p@gate.pro\tvider.com:7000', `http://u:${'p'.repeat(1000)}@gate.provider.com:7000`,
    ]) expect(checkProxyUrl(bad)).toEqual({ ok: false, message: PROXY_URL_EXAMPLE });
    expect(checkProxyUrl('http://user-{city}:p@gate.provider.com:7000')).toEqual({ ok: false, message: ONLY_COUNTRY_TOKEN });
    expect(checkProxyUrl('http://user-{country:p@gate.provider.com:7000')).toEqual({ ok: false, message: ONLY_COUNTRY_TOKEN });
    expect(checkProxyUrl('socks5://u:p@10.0.0.5:1080')).toEqual({ ok: false, message: SOCKS_NO_AUTH });
  });

  it('counts the 1,000 characters as typed', () => {
    const at = (n: number) => `http://u:${'p'.repeat(n - 'http://u:@h.io:7000'.length)}@h.io:7000`;
    expect(at(1000)).toHaveLength(1000);
    expect(checkProxyUrl(at(1000)).ok).toBe(true);
    expect(checkProxyUrl(at(1001)).ok).toBe(false);
  });
});

describe('proxySettingsFor (spec §2.1, §2.2)', () => {
  it('fills in {country} lower-case and hands Playwright the server and the credentials apart', () => {
    expect(proxySettingsFor('http://user-country-{country}:pass@gate.provider.com:7000', 'DE'))
      .toEqual({ server: 'http://gate.provider.com:7000', username: 'user-country-de', password: 'pass' });
    expect(proxySettingsFor('socks5://10.0.0.5:1080', null)).toEqual({ server: 'socks5://10.0.0.5:1080' });
    expect(proxySettingsFor('http://{country}.gate.provider.com:7000', 'gb')).toEqual({ server: 'http://gb.gate.provider.com:7000' });
    expect(proxySettingsFor('http://u@gate.provider.com:7000', null)).toEqual({ server: 'http://gate.provider.com:7000', username: 'u' });
  });

  it('answers null for an address that does not check, or {country} with no country', () => {
    expect(proxySettingsFor('ftp://gate.provider.com:21', null)).toBeNull();
    expect(proxySettingsFor('http://user-{country}:p@gate.provider.com:7000', null)).toBeNull();
  });
});

describe('masking and redaction (spec §2.1 "Storage", §2.3, §3.2)', () => {
  it('masks the password for staff, keeps the rest', () => {
    expect(maskProxyUrl('http://user-country-{country}:pass@gate.provider.com:7000')).toBe('http://user-country-{country}:•••@gate.provider.com:7000');
    expect(maskProxyUrl('http://u@gate.provider.com:7000')).toBe('http://u@gate.provider.com:7000');
    expect(maskProxyUrl('http://gate.provider.com:7000')).toBe('http://gate.provider.com:7000');
  });

  it('redacts the userinfo of every proxy address in a text', () => {
    expect(redactProxy('via http://u:secret@gate.provider.com:7000 and socks5://a:b@10.0.0.5:1080 failed'))
      .toBe('via http://***@gate.provider.com:7000 and socks5://***@10.0.0.5:1080 failed');
    expect(redactProxy('nothing to hide at http://gate.provider.com:7000')).toBe('nothing to hide at http://gate.provider.com:7000');
  });

  it('RF3: encoded and raw reserved characters reach the browser decoded and never show', () => {
    const encoded = 'http://shop-user:p%40ss%3Aw%2Frd@gate.provider.com:7000';
    expect(checkProxyUrl(encoded).ok).toBe(true);
    expect(parseProxyUrl(encoded)).toMatchObject({ username: 'shop-user', password: 'p@ss:w/rd', host: 'gate.provider.com', port: 7000 });
    expect(proxySettingsFor(encoded, null)).toEqual({ server: 'http://gate.provider.com:7000', username: 'shop-user', password: 'p@ss:w/rd' });
    const raw = 'http://shop-user:p@ss@gate.provider.com:7000';
    expect(checkProxyUrl(raw).ok).toBe(true);
    expect(proxySettingsFor(raw, null)).toEqual({ server: 'http://gate.provider.com:7000', username: 'shop-user', password: 'p@ss' });
    for (const url of [encoded, raw]) {
      expect(maskProxyUrl(url)).toBe('http://shop-user:•••@gate.provider.com:7000');
      expect(redactProxy(`could not use ${url} now`)).toBe('could not use http://***@gate.provider.com:7000 now');
    }
    expect(parseProxyUrl('http://u:%E0%A4%A@gate.provider.com:7000')).toBeNull(); // a broken escape is not a password
  });
});
