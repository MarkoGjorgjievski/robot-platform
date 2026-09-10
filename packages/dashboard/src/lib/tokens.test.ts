import { describe, it, expect } from 'vitest';
import { palette, textOnTint, contrastRatio } from './tokens.js';

describe('tokens', () => {
  it('contrastRatio matches the WCAG reference pairs', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  it('every text token on its tint is at least 4.5:1 (spec 7)', () => {
    for (const [text, bg] of textOnTint) {
      expect(contrastRatio(palette[text], palette[bg]), `${text} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
