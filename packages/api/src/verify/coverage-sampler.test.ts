import { describe, it, expect } from 'vitest';
import { sampleListing, COVERAGE_SAMPLE_SIZE } from './coverage-sampler.js';

const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://s.example/p/${i + 1}`);

describe('sampleListing (spec 2026-10-10 §A2, D1)', () => {
  it('drops the proof pages and takes everything when fewer than twenty remain', () => {
    expect(sampleListing(urls(5), ['https://s.example/p/2'])).toEqual(['https://s.example/p/1', 'https://s.example/p/3', 'https://s.example/p/4', 'https://s.example/p/5']);
  });
  it('spreads twenty over a long listing: the first link, then evenly to the end', () => {
    const out = sampleListing(urls(103), []);
    expect(out).toHaveLength(COVERAGE_SAMPLE_SIZE);
    expect(out[0]).toBe('https://s.example/p/1');
    expect(out[1]).toBe('https://s.example/p/6'); // floor(1 * 103 / 20) = 5
    expect(out[19]).toBe('https://s.example/p/98'); // floor(19 * 103 / 20) = 97: the end of the list is reached
    expect(new Set(out).size).toBe(20);
  });
  it('twenty-five links give twenty distinct ones spread over all twenty-five, not the first twenty', () => {
    const out = sampleListing(urls(25), []);
    expect(out).toHaveLength(COVERAGE_SAMPLE_SIZE);
    expect(new Set(out).size).toBe(20);
    const indices = out.map((u) => Number(u.split('/').pop()) - 1);
    expect(indices).toEqual(Array.from({ length: 20 }, (_, i) => Math.floor((i * 25) / 20)));
    expect(indices.at(-1)).toBe(23);
    expect(indices.slice(0, 5)).toEqual([0, 1, 2, 3, 5]);
  });
  it('compares proof pages after normalising a trailing slash and the fragment', () => {
    expect(sampleListing(['https://s.example/p/1/', 'https://s.example/p/2#x'], ['https://s.example/p/1', 'https://s.example/p/2'])).toEqual([]);
  });
  it('nothing to sample is an empty list, not an error', () => {
    expect(sampleListing([], [])).toEqual([]);
  });
});
