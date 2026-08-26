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

describe('buildDisplayedPrompt — product scoping', () => {
  // 2026-08-26 dogfood: the judge marked Target's displayed price as the $50
  // protection-plan add-on — visible on the page, but not the product's own
  // price. The prompt must scope the question to the main product and name
  // the wrong-entity values that do not count even when visible.
  it('scopes the question to the main product and excludes add-on values', () => {
    const p = buildDisplayedPrompt('price', [{ label: 'current', value: 269 }]);
    expect(p).toContain('main product');
    expect(p).toMatch(/protection plan/i);
    expect(p).toMatch(/accessor/i);
    expect(p).toMatch(/even (if|when) visible/i);
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
