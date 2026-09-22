import { describe, it, expect } from 'vitest';
import { siteNameFromUrl, hostnameOf } from './site-name';

describe('siteNameFromUrl', () => {
  const cases: Array<[string, string]> = [
    ['https://www.ikea.com/my/en/', 'Ikea'],
    ['https://shop.currys.co.uk/x', 'Currys'],
    ['https://example.org', 'Example'],
    ['http://localhost:3000', ''],
    ['not a url', ''],
  ];
  for (const [url, name] of cases) it(`${url} → "${name}"`, () => expect(siteNameFromUrl(url)).toBe(name));
});

describe('hostnameOf', () => {
  it('gives the hostname, and nothing for nothing', () => {
    expect(hostnameOf('https://shop.currys.co.uk/x?y=1')).toBe('shop.currys.co.uk');
    expect(hostnameOf(null)).toBe('');
    expect(hostnameOf('nope')).toBe('');
  });
});
