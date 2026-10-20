import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import { refusalProblems, refuseVerify, VerifyRefusal, VERIFY_REFUSED } from './verify-refusal.js';

describe('refusalProblems (spec 2026-10-20 §3.2)', () => {
  it('keeps blank and too-few problems, folds the rest into one "other", and puts "other" last', () => {
    expect(refusalProblems([
      { text: 'All URLs must be on the same website', reason: 'other' },
      { text: 'Rating @ https://s.example/p/3: Expected value is required', reason: 'blank', field: 'Rating', product: 3 },
      { text: 'Price @ https://s.example/p/1: Not a money amount', reason: 'other', field: 'Price', product: 1 },
      { text: 'Brand: needs a value on at least two products, or "not on this product" on every one', reason: 'too_few_values', field: 'Brand' },
    ])).toEqual([
      { reason: 'blank', field: 'Rating', product: 3 },
      { reason: 'too_few_values', field: 'Brand' },
      { reason: 'other' },
    ]);
  });
  it('carries no address and no "@"', () => {
    const json = JSON.stringify(refusalProblems([{ text: 'Rating @ https://s.example/p/3: Expected value is required', reason: 'blank', field: 'Rating', product: 3 }]));
    expect(json).not.toMatch(/https?:|@/);
  });
});

describe('refuseVerify', () => {
  it('is a PRECONDITION_FAILED whose cause holds the problems and whose message holds none of the raw text', () => {
    const err = refuseVerify([{ reason: 'blank', field: 'Rating', product: 3 }], ['Rating @ https://s.example/p/3: Expected value is required']);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe('PRECONDITION_FAILED');
    expect(err.message).toBe(VERIFY_REFUSED);
    expect(err.cause).toBeInstanceOf(VerifyRefusal);
    expect((err.cause as VerifyRefusal).problems).toEqual([{ reason: 'blank', field: 'Rating', product: 3 }]);
  });
});
