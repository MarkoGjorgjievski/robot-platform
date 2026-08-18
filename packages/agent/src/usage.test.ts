import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordUsage, snapshotUsage, resetUsage, diffUsage, estimateCostUsd, formatUsage,
} from './usage.js';

beforeEach(resetUsage);

describe('recordUsage', () => {
  it('accumulates across calls to the same model', () => {
    recordUsage('claude-sonnet-5', { input_tokens: 100, output_tokens: 20 });
    recordUsage('claude-sonnet-5', { input_tokens: 50, output_tokens: 10 });
    const u = snapshotUsage()['claude-sonnet-5']!;
    expect(u).toMatchObject({ inputTokens: 150, outputTokens: 30, requests: 2 });
  });

  it('keeps models separate', () => {
    recordUsage('claude-sonnet-5', { input_tokens: 100, output_tokens: 20 });
    recordUsage('claude-haiku-4-5', { input_tokens: 7, output_tokens: 3 });
    expect(Object.keys(snapshotUsage()).sort()).toEqual(['claude-haiku-4-5', 'claude-sonnet-5']);
  });

  it('ignores a missing usage block rather than throwing', () => {
    expect(() => recordUsage('claude-sonnet-5', null)).not.toThrow();
    expect(() => recordUsage('claude-sonnet-5', undefined)).not.toThrow();
    expect(snapshotUsage()).toEqual({});
  });

  it('treats absent counters as zero', () => {
    recordUsage('claude-sonnet-5', { input_tokens: 10 });
    expect(snapshotUsage()['claude-sonnet-5']).toMatchObject({ inputTokens: 10, outputTokens: 0 });
  });
});

describe('snapshotUsage', () => {
  it('returns a copy that later recording cannot mutate', () => {
    recordUsage('claude-sonnet-5', { input_tokens: 100, output_tokens: 20 });
    const snap = snapshotUsage();
    recordUsage('claude-sonnet-5', { input_tokens: 900, output_tokens: 90 });
    expect(snap['claude-sonnet-5']!.inputTokens).toBe(100);
  });
});

describe('diffUsage', () => {
  it('attributes only the spend between two snapshots', () => {
    recordUsage('claude-sonnet-5', { input_tokens: 100, output_tokens: 20 });
    const before = snapshotUsage();
    recordUsage('claude-sonnet-5', { input_tokens: 40, output_tokens: 5 });
    const d = diffUsage(before, snapshotUsage());
    expect(d['claude-sonnet-5']).toMatchObject({ inputTokens: 40, outputTokens: 5, requests: 1 });
  });

  it('omits models that did not move', () => {
    recordUsage('claude-haiku-4-5', { input_tokens: 10, output_tokens: 2 });
    const before = snapshotUsage();
    recordUsage('claude-sonnet-5', { input_tokens: 1, output_tokens: 1 });
    expect(Object.keys(diffUsage(before, snapshotUsage()))).toEqual(['claude-sonnet-5']);
  });
});

describe('estimateCostUsd', () => {
  it('prices input and output at the model rate', () => {
    // 1M in + 1M out on Sonnet 5 list rates = $3 + $15
    const { usd } = estimateCostUsd({
      'claude-sonnet-5': { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreationTokens: 0, cacheReadTokens: 0, requests: 1 },
    });
    expect(usd).toBeCloseTo(18, 5);
  });

  it('discounts cache reads and surcharges cache writes', () => {
    const { usd } = estimateCostUsd({
      'claude-sonnet-5': { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 1_000_000, cacheReadTokens: 1_000_000, requests: 1 },
    });
    expect(usd).toBeCloseTo(3 * 1.25 + 3 * 0.1, 5);
  });

  it('never guesses at an unknown model — it reports it instead', () => {
    const { usd, unpricedModels } = estimateCostUsd({
      'some-future-model': { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreationTokens: 0, cacheReadTokens: 0, requests: 1 },
    });
    expect(usd).toBe(0);
    expect(unpricedModels).toEqual(['some-future-model']);
  });
});

describe('formatUsage', () => {
  it('says so plainly when nothing was spent', () => {
    expect(formatUsage({})).toBe('no API calls recorded');
  });

  it('surfaces an unpriced model rather than quietly reporting a low cost', () => {
    const out = formatUsage({
      'some-future-model': { inputTokens: 5000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0, requests: 3 },
    });
    expect(out).toContain('NOT PRICED');
    expect(out).toContain('some-future-model');
  });
});
