// Deterministic guard on the judge request shape. Free, offline, runs in the
// default `pnpm -r test` gate.
//
// This exists because the live calibration suite CANNOT catch this class of bug.
// The judges are one-word classifiers on a tiny token budget, and thinking is on
// by default for the current model family. On a complex real screenshot the model
// spends the whole budget reasoning and returns a `thinking` block with no text
// block, which the judges report as verdict 'error'. On the simple fixture page
// the calibration uses, thinking does not kick in — so calibration passes 11/11
// while production silently mislabels fields.
//
// That is exactly what happened on the 2026-08-18 Newegg run: three fields came
// back 'error' with stop_reason=max_tokens and blocks=thinking. They were not
// judge glitches — once thinking was disabled all three resolved to real verdicts
// ('wrong'), i.e. genuine extraction errors that 'error' had been hiding.

import { describe, it, expect } from 'vitest';
import { JUDGE_REQUEST_TUNING } from './judge.js';

const VERDICTS = ['correct', 'wrong', 'not-on-page', 'unverifiable'];

describe('judge request tuning', () => {
  it('disables thinking — a thinking judge returns no text block and every field becomes "error"', () => {
    expect(JUDGE_REQUEST_TUNING.thinking).toEqual({ type: 'disabled' });
  });

  it('leaves token headroom over the longest verdict', () => {
    // Rough upper bound: one token per 2 characters is pessimistic for these
    // short ASCII words, so this only fails if max_tokens is set absurdly low.
    const longest = Math.max(...VERDICTS.map((v) => v.length));
    expect(JUDGE_REQUEST_TUNING.max_tokens).toBeGreaterThan(longest);
  });
});
