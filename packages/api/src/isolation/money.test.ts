import { describe, expect, it } from 'vitest';
import { moneyFields, viewerSeesMoney } from './money.js';

describe('who receives money (spec 2026-10-24 tenant isolation §2.3)', () => {
  it("is the app's showsMoney rule: an operator, or a staff session", () => {
    expect(viewerSeesMoney({ isOperator: false, session: { staff: null } })).toBe(false);
    expect(viewerSeesMoney({ isOperator: true, session: { staff: null } })).toBe(true);
    expect(viewerSeesMoney({ isOperator: false, session: { staff: { orgId: 'o', enteredAt: new Date() } } })).toBe(true);
    expect(viewerSeesMoney({ session: null })).toBe(false);
  });

  it('a customer gets the keys left out, not zeroed', () => {
    expect(moneyFields(false, { costUsd: 1.5 })).toEqual({});
    expect('costUsd' in moneyFields(false, { costUsd: 1.5 })).toBe(false);
    expect(moneyFields(true, { costUsd: 0 })).toEqual({ costUsd: 0 });
  });
});
