import { describe, it, expect } from 'vitest';
import { slugify, uniqueSlug } from './slug.js';

describe('slugify', () => {
  it('lowercases, strips accents and punctuation, collapses separators', () => {
    expect(slugify('AbeBooks Q3')).toBe('abebooks-q3');
    expect(slugify('  Currys — laptops!  ')).toBe('currys-laptops');
    expect(slugify('Çà et là')).toBe('ca-et-la');
  });
  it('never returns an empty slug', () => {
    expect(slugify('***')).toBe('item');
  });
  it('caps length at 60', () => {
    expect(slugify('a'.repeat(100)).length).toBe(60);
  });
});

describe('uniqueSlug', () => {
  it('returns the base when free', async () => {
    expect(await uniqueSlug('abebooks', async () => false)).toBe('abebooks');
  });
  it('appends the first free counter', async () => {
    const taken = new Set(['abebooks', 'abebooks-2']);
    expect(await uniqueSlug('abebooks', async (s) => taken.has(s))).toBe('abebooks-3');
  });
});
