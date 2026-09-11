import { describe, it, expect } from 'vitest';
import { palette, textOnTint, contrastRatio } from './tokens.js';

describe('tokens', () => {
  it('contrastRatio matches the WCAG reference pairs', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  it('every text/background pairing the app renders is at least 4.5:1 (spec 7)', () => {
    for (const [text, bg] of textOnTint) {
      expect(contrastRatio(palette[text], palette[bg]), `${text} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // The one pairing left out of the list above, recorded so the omission reads
  // as a decision rather than an oversight: the status strip's stage line used
  // to be `text-gray-500` (= changed) on the strip's paper-dark and missed the
  // floor by 0.01. It is ink now. Nothing may put `changed` back on the strip.
  it('changed on paper-dark misses the floor, so it is not in the list', () => {
    expect(contrastRatio(palette.changed, palette.paperDark)).toBeLessThan(4.5);
    expect(textOnTint).not.toContainEqual(['changed', 'paperDark']);
  });
});
