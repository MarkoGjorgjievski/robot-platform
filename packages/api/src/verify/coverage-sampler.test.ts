import { describe, it, expect } from 'vitest';
import { sampleListing, COVERAGE_SAMPLE_SIZE } from './coverage-sampler.js';

const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://s.example/p/${i + 1}`);

describe('sampleListing (spec 2026-10-10 §A2, D1)', () => {
  it('drops the proof pages and takes everything when fewer than twenty remain', () => {
    expect(sampleListing(urls(5), ['https://s.example/p/2'])).toEqual(['https://s.example/p/1', 'https://s.example/p/3', 'https://s.example/p/4', 'https://s.example/p/5']);
  });
  it('spreads twenty over a long listing: the first link, then every k-th', () => {
    const out = sampleListing(urls(103), []);
    expect(out).toHaveLength(COVERAGE_SAMPLE_SIZE);
    expect(out[0]).toBe('https://s.example/p/1');
    expect(out[1]).toBe('https://s.example/p/6'); // k = floor(103 / 20) = 5
    expect(new Set(out).size).toBe(20);
  });
  it('compares proof pages after normalising a trailing slash and the fragment', () => {
    expect(sampleListing(['https://s.example/p/1/', 'https://s.example/p/2#x'], ['https://s.example/p/1', 'https://s.example/p/2'])).toEqual([]);
  });
  it('nothing to sample is an empty list, not an error', () => {
    expect(sampleListing([], [])).toEqual([]);
  });
});
