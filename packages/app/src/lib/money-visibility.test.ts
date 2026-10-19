import { describe, it, expect } from 'vitest';
import { showsMoney } from './money-visibility';

describe('showsMoney (spec 2026-10-17 §8a)', () => {
  it('a customer never sees money', () => expect(showsMoney({ isOperator: false, staff: null })).toBe(false));
  it('an operator does', () => expect(showsMoney({ isOperator: true, staff: null })).toBe(true));
  it('a staff session inside a customer org does', () => expect(showsMoney({ isOperator: false, staff: { orgId: 'o', expiresAt: '2026-10-17T20:00:00Z' } })).toBe(true));
});
