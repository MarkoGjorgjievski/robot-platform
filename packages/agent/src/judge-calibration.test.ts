// Calibration for the Tier 2 LLM judge.
//
// The judge is the measurement instrument for the whole Tier 2 dogfood harness.
// Every "resolved but wrong" and "not on page" line in docs/testing/results/ is
// the judge's opinion, and until this file existed nothing checked that opinion
// against a known answer. That gap was not theoretical: Haiku 4.5 was very nearly
// adopted here as the cheaper judge and scores 7/9 on the table below, with a
// false `not-on-page` on `currency` and a false `wrong` on a correct SKU — it
// would have invented the exact bogus-verdict cluster we were trying to measure.
//
// Live and paid, so it does not run in the default `pnpm -r test` gate.
// Run it with:  pnpm test:judge     (from the repo root)
//
// Not covered yet: judgeVariantArray. It needs a page with visible variant
// swatches to calibrate against, which this fixture page deliberately lacks.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { judgeFieldExtraction, type JudgeVerdict } from './judge.js';
import { judgeDisplayedCandidate } from './judge-displayed.js';

// vitest does not load .env, and this package has no @robot/db import to do it
// for us — pull the repo-root .env in directly.
try {
  loadEnvFile(join(fileURLToPath(new URL('../../..', import.meta.url)), '.env'));
} catch {
  // .env not present — fall back to whatever is already in process.env
}

const ENABLED = process.env.RUN_JUDGE_CALIBRATION === '1';
const apiKey = process.env.ANTHROPIC_API_KEY ?? '';

const screenshot = () =>
  readFileSync(
    join(fileURLToPath(new URL('.', import.meta.url)), '__fixtures__', 'judge-calibration', 'page.png'),
  );

/**
 * Known-answer cases against __fixtures__/judge-calibration/page.html, which
 * shows exactly: title "KALLAX Shelf unit, white", price $79.99, rating 4.7
 * (10,528 reviews), article number 802.758.87.
 *
 * Each expectation is what a careful human reading that page would say. Keep it
 * that way — if a case is arguable, it belongs in the fixture page or nowhere.
 */
const CASES: Array<{ field: string; value: unknown; expected: JudgeVerdict; why: string }> = [
  { field: 'price', value: '79.99', expected: 'correct', why: 'exact match, plainly visible' },
  { field: 'price', value: '129.99', expected: 'wrong', why: 'a price is visible and it is not this one' },
  { field: 'rating', value: 4.7, expected: 'correct', why: 'numeric value, matches' },
  { field: 'sku', value: '802.758.87', expected: 'correct', why: 'article number is the SKU — Haiku 4.5 calls this wrong' },
  { field: 'product_name', value: 'KALLAX Shelf unit, white', expected: 'correct', why: 'matches the h1' },
  { field: 'product_name', value: 'otFlat', expected: 'wrong', why: 'the cache-poisoning value the harness exists to catch' },
  { field: 'shipping_weight', value: '12 kg', expected: 'not-on-page', why: 'a plain value genuinely absent from the page' },
  { field: 'currency', value: 'USD', expected: 'correct', why: 'the $ sign states it — Haiku 4.5 calls this not-on-page' },
  // The metadata family. A screenshot can neither confirm nor deny these, and
  // calling them 'not-on-page' reads as an extraction failure when nothing is
  // wrong — that conflation produced 6 bogus verdicts in the 2026-05-28 report
  // and 4 in the 2026-08-18 one.
  { field: 'availability', value: 'https://schema.org/InStock', expected: 'unverifiable', why: 'schema.org URI, never rendered as text' },
  { field: 'product_url', value: 'https://www.ikea.com/us/en/p/kallax-shelf-unit-white-80275887/', expected: 'unverifiable', why: 'the page URL is not part of the page image' },
  { field: 'image_url', value: 'https://www.ikea.com/img/kallax-white.jpg', expected: 'unverifiable', why: 'an image URL cannot be read off a rendered image' },
];

/**
 * One flipped verdict is tolerable LLM nondeterminism; two is a different judge.
 * The gap this defends is 11/11 (Sonnet 5) vs 7/9 (Haiku 4.5 on the original table).
 */
const MIN_SCORE = 10;

describe.skipIf(!ENABLED)('Tier 2 judge calibration (live, paid)', () => {
  it(`scores at least ${MIN_SCORE}/${CASES.length} on known-answer cases`, async () => {
    expect(apiKey, 'ANTHROPIC_API_KEY required for judge calibration').not.toBe('');
    const png = screenshot();

    const results = await Promise.all(
      CASES.map(async (c) => ({
        ...c,
        got: await judgeFieldExtraction({ screenshot: png, field: c.field, value: c.value, apiKey }),
      })),
    );

    const report = results
      .map((r) => `  ${r.got === r.expected ? 'PASS' : 'FAIL'}  ${r.field}=${JSON.stringify(r.value)}  expected=${r.expected}  got=${r.got}  (${r.why})`)
      .join('\n');
    const score = results.filter((r) => r.got === r.expected).length;

    expect(score, `judge scored ${score}/${CASES.length}\n${report}`).toBeGreaterThanOrEqual(MIN_SCORE);
  }, 120_000);
});

describe.skipIf(!ENABLED)('Displayed-candidate judge calibration (live, paid)', () => {
  it('picks the price candidate the fixture page actually shows ($79.99)', async () => {
    expect(apiKey, 'ANTHROPIC_API_KEY required for judge calibration').not.toBe('');
    const png = screenshot();

    // Known answer against __fixtures__/judge-calibration/page.html: the
    // product's price is $79.99. "was" is a plausible strike-through list
    // price this page does not have; "protection_plan" is $9.99 and IS
    // visible on the page — as an add-on, not the product's price. The 2026-08-26
    // Target dogfood proved an unscoped judge picks exactly that kind of
    // wrong-entity value; this case fails if the scoping ever regresses.
    const label = await judgeDisplayedCandidate({
      screenshot: png,
      concept: 'price',
      candidates: [
        { label: 'current', value: 79.99 },
        { label: 'was', value: 129.99 },
        { label: 'protection_plan', value: 9.99 },
      ],
      apiKey,
    });

    expect(label).toBe('current');
  }, 120_000);
});
