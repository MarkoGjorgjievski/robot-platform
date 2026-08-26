import { describe, it, expect } from 'vitest';
import { buildDisplayedPrompt, parseDisplayedVerdict } from './judge-displayed.js';

describe('parseDisplayedVerdict', () => {
  it('returns the label the model named', () => {
    expect(parseDisplayedVerdict('DISPLAYED: list', ['list', 'final'])).toBe('list');
  });
  it('returns null for NONE', () => {
    expect(parseDisplayedVerdict('DISPLAYED: NONE', ['list'])).toBeNull();
  });
  it('returns null for a label not offered (a hallucinated label must not stick)', () => {
    expect(parseDisplayedVerdict('DISPLAYED: promo', ['list', 'final'])).toBeNull();
  });
});

describe('buildDisplayedPrompt', () => {
  it('offers every candidate with its value and demands the DISPLAYED: sentinel', () => {
    const p = buildDisplayedPrompt('price', [{ label: 'list', value: 679.99 }, { label: 'final', value: 399.99 }]);
    expect(p).toContain('list');
    expect(p).toContain('679.99');
    expect(p).toContain('DISPLAYED:');
    expect(p).toContain('NONE');
  });
});
