import { describe, it, expect } from 'vitest';
import { nameProblem, THEME_OPTIONS } from './account-view';

describe('nameProblem', () => {
  it('wants a name, and not a novel', () => {
    expect(nameProblem('Ada')).toBeNull();
    expect(nameProblem('  Ada  ')).toBeNull();
    expect(nameProblem('')).toBe('Enter a name');
    expect(nameProblem('   ')).toBe('Enter a name');
    expect(nameProblem('a'.repeat(255))).toBeNull();
    expect(nameProblem('a'.repeat(256))).toBe('Keep it to 255 characters or fewer');
  });
});

describe('THEME_OPTIONS', () => {
  it('offers the three preferences the session stores, dark first', () => {
    expect(THEME_OPTIONS.map((o) => o.value)).toEqual(['dark', 'light', 'system']);
    expect(THEME_OPTIONS.map((o) => o.label)).toEqual(['Dark', 'Light', 'System']);
    for (const o of THEME_OPTIONS) expect(o.hint.length).toBeGreaterThan(0);
  });
});
