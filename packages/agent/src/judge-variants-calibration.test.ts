// Calibration for judgeVariantArray — the last unverified judge.
//
// judgeFieldExtraction got a calibration harness in 38a426d, which immediately
// caught a prompt rewrite that had started accepting the `otFlat` cache-poisoning
// value as correct. judgeVariantArray had none, despite variants being a headline
// feature and its verdicts appearing in every Tier 2 report since 2026-05-28.
//
// Live and paid, so it does not run in the default `pnpm -r test` gate:
//   pnpm test:judge     (runs both calibrations)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { judgeVariantArray } from './judge-variants.js';
import type { JudgeVerdict } from './judge.js';
import type { Variant } from './types.js';

try {
  loadEnvFile(join(fileURLToPath(new URL('../../..', import.meta.url)), '.env'));
} catch {
  // .env not present — fall back to whatever is already in process.env
}

const ENABLED = process.env.RUN_JUDGE_CALIBRATION === '1';
const apiKey = process.env.ANTHROPIC_API_KEY ?? '';

const screenshot = () =>
  readFileSync(
    join(fileURLToPath(new URL('.', import.meta.url)), '__fixtures__', 'judge-calibration', 'variants-page.png'),
  );

/**
 * Cases against __fixtures__/judge-calibration/variants-page.html, which shows a
 * colour picker with exactly three options: Black $129.99, White $129.99, and
 * Cobalt $139.99 marked out of stock.
 */
const CASES: Array<{ label: string; variants: Variant[]; expected: JudgeVerdict; why: string }> = [
  {
    label: 'exact match',
    variants: [
      { color: 'Black', price: 129.99 },
      { color: 'White', price: 129.99 },
      { color: 'Cobalt', price: 139.99 },
    ],
    expected: 'correct',
    why: 'all three options, right colours, right prices',
  },
  {
    label: 'axes only, no prices',
    variants: [{ color: 'Black' }, { color: 'White' }, { color: 'Cobalt' }],
    expected: 'correct',
    why: 'v1.1b decided axes-only variants are valid — the picker is what matters',
  },
  {
    label: 'missing an option the picker shows',
    variants: [{ color: 'Black' }, { color: 'White' }],
    expected: 'wrong',
    why: 'Cobalt is visibly offered and absent from the list',
  },
  {
    label: 'invented option',
    variants: [{ color: 'Black' }, { color: 'White' }, { color: 'Cobalt' }, { color: 'Crimson' }],
    expected: 'wrong',
    why: 'Crimson is not on the page — the hallucination case',
  },
  {
    label: 'recommendations carousel mistaken for variants',
    variants: [
      { name: 'Trail Runner Pro', price: 159.99 },
      { name: 'Aero Lite', price: 99.99 },
    ],
    expected: 'wrong',
    why: 'other PRODUCTS, not options of this one — the failure the shape validator also guards',
  },
];

/** One flipped verdict is tolerable nondeterminism; two is a different judge. */
const MIN_SCORE = CASES.length - 1;

describe.skipIf(!ENABLED)('Tier 2 variant judge calibration (live, paid)', () => {
  it(`scores at least ${MIN_SCORE}/${CASES.length} on known-answer cases`, async () => {
    expect(apiKey, 'ANTHROPIC_API_KEY required for judge calibration').not.toBe('');
    const png = screenshot();

    const results = await Promise.all(
      CASES.map(async (c) => ({
        ...c,
        got: await judgeVariantArray({ screenshot: png, variants: c.variants, apiKey }),
      })),
    );

    const report = results
      .map((r) => `  ${r.got === r.expected ? 'PASS' : 'FAIL'}  ${r.label}  expected=${r.expected}  got=${r.got}  (${r.why})`)
      .join('\n');
    const score = results.filter((r) => r.got === r.expected).length;

    expect(score, `variant judge scored ${score}/${CASES.length}\n${report}`).toBeGreaterThanOrEqual(MIN_SCORE);
  }, 120_000);
});
