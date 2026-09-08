import { describe, it, expect } from 'vitest';
import { siteNameFromUrl } from './site-name';

describe('siteNameFromUrl', () => {
  it('uses the registrable label, capitalised', () => {
    expect(siteNameFromUrl('https://www.abebooks.com/')).toBe('Abebooks');
    expect(siteNameFromUrl('https://shop.currys.co.uk/laptops')).toBe('Currys');
    expect(siteNameFromUrl('http://biblio.com')).toBe('Biblio');
  });
  it('returns an empty string for anything that is not a url yet', () => {
    expect(siteNameFromUrl('abebooks')).toBe('');
    expect(siteNameFromUrl('')).toBe('');
  });
});
