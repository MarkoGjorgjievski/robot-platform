import { describe, it, expect } from 'vitest';
import {
  rankCandidates, probeUrl, templateFor, overlapShare, REPLAY_MAX_OVERLAP,
} from './api-param-candidates.js';

describe('rankCandidates', () => {
  it('offers page-style names before offset-style ones', () => {
    const names = rankCandidates('https://x.example/a?offset=0&page=1', 30).map((c) => c.paramName);
    expect(names.indexOf('page')).toBeLessThan(names.indexOf('offset'));
  });

  it('gives a page-style parameter a step of 1 first, and the page size as a fallback', () => {
    const forPage = rankCandidates('https://x.example/a?page=1', 30).filter((c) => c.paramName === 'page');
    expect(forPage.map((c) => c.step)).toEqual([1, 30]);
  });

  it('gives an offset-style parameter the page size first, and 1 as a fallback', () => {
    // The AbeBooks lesson generalised: the STEP is part of the hypothesis. An
    // offset bumped by 1 returns items 1..30 instead of 30..59 — a window that
    // overlaps page 1 almost entirely, which is a wrong answer that parses.
    const forOffset = rankCandidates('https://x.example/a?offset=0', 30).filter((c) => c.paramName === 'offset');
    expect(forOffset.map((c) => c.step)).toEqual([30, 1]);
  });

  it('ignores parameters that are not numeric', () => {
    const names = rankCandidates('https://x.example/a?page=abc&q=python', 30).map((c) => c.paramName);
    expect(names).toEqual([]);
  });

  it('ignores parameters whose names are not known pagers', () => {
    // AbeBooks carried ds, sp and spo alongside the real pager. A name we do not
    // recognise is not a candidate; it is noise.
    const names = rankCandidates('https://x.example/a?ds=1&spo=30&p=1', 30).map((c) => c.paramName);
    expect(new Set(names)).toEqual(new Set(['p']));
  });

  it('carries the parameter\'s current value so the probe can advance from it', () => {
    expect(rankCandidates('https://x.example/a?offset=60', 30)[0]).toMatchObject({ from: 60, step: 30 });
  });
});

describe('probeUrl', () => {
  it('advances the candidate parameter and leaves every other one alone', () => {
    const url = probeUrl('https://x.example/a?kn=py&offset=0&spo=30', { paramName: 'offset', from: 0, step: 30 });
    expect(new URL(url).searchParams.get('offset')).toBe('30');
    expect(new URL(url).searchParams.get('kn')).toBe('py');
    expect(new URL(url).searchParams.get('spo')).toBe('30');
  });
});

describe('templateFor', () => {
  it('replaces only the paging parameter with {N}', () => {
    expect(templateFor('https://x.example/a?kn=py&offset=0', 'offset'))
      .toBe('https://x.example/a?kn=py&offset={N}');
  });
});

describe('overlapShare', () => {
  it('is 1 when the probe returned exactly page 1 again', () => {
    // The AbeBooks failure, as a number. This is what a wrong parameter looks like.
    expect(overlapShare(['a1', 'b2', 'c3'], ['a1', 'b2', 'c3'])).toBe(1);
  });

  it('is 0 when the probe returned a genuinely different page', () => {
    expect(overlapShare(['a1', 'b2'], ['d4', 'e5'])).toBe(0);
  });

  it('is 0 when the probe returned nothing', () => {
    expect(overlapShare(['a1', 'b2'], [])).toBe(0);
  });

  it('rejects a mostly-overlapping window at the documented threshold', () => {
    // An offset bumped by 1: 29 of 30 items are page 1's.
    const page1 = Array.from({ length: 30 }, (_, i) => `id${i}`);
    const shifted = Array.from({ length: 30 }, (_, i) => `id${i + 1}`);
    expect(overlapShare(page1, shifted)).toBeGreaterThan(REPLAY_MAX_OVERLAP);
  });

  it('measures against page 1, so a probe padded with new items still counts as a repeat', () => {
    // The discriminating case, and the one the AbeBooks incident argues for: a
    // probe handing back most of page 1 PLUS a pile of new items is still
    // re-serving page 1. Dividing by the probe's larger set scores this
    // 6/20 = 0.3 and ACCEPTS a broken pager; dividing by page 1's set scores it
    // 6/10 = 0.6 and rejects it. Nothing else in this file can tell the two apart.
    const page1 = Array.from({ length: 10 }, (_, i) => `old${i}`);
    const probe = [...page1.slice(0, 6), ...Array.from({ length: 14 }, (_, i) => `new${i}`)];

    expect(overlapShare(page1, probe)).toBeCloseTo(0.6);
    expect(overlapShare(page1, probe)).toBeGreaterThan(REPLAY_MAX_OVERLAP);
  });
});
