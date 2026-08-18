// Regression: one malformed field from the LLM must not destroy a whole extraction pass.
//
// `SelectorField.xpath` is typed `string`, but plans reach the executor through an
// `as ExtractionPlan` cast over raw LLM tool output. The tool schema marks xpath
// required, but without `strict: true` the API does not enforce it, so a field can
// arrive with xpath undefined — and v1.1b's reverse-search design deliberately
// supports fields that carry only an AI-seen `value` and no working selector.
//
// Before the fix, buildExtractionScript emitted an unguarded
// `field.xpath.startsWith(...)` in its xpath-validation loop. An undefined xpath
// threw inside page.evaluate, rejecting the ENTIRE evaluate — so every other field
// in that pass was lost too, not just the malformed one. Seen live on the
// 2026-08-18 Newegg dogfood: "Tile 2 escalation failed (non-fatal): TypeError:
// Cannot read properties of undefined (reading 'startsWith')".

import { describe, it, expect } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { buildExtractionScript } from './executor.js';
import type { ExtractionPlan } from '@robot/agent';

const HTML = `<html><body><main>
  <h1 class="title">KALLAX Shelf unit</h1>
  <span class="price">79.99</span>
</main></body></html>`;

/** A plan as the LLM can actually return it: one good field, one with no xpath. */
const PLAN = {
  row_xpath: '//main',
  fields: [
    { name: 'title', xpath: './/h1[@class="title"]', attribute: 'textContent', transform: 'trim' },
    // AI saw a value but produced no selector — xpath absent despite being "required"
    { name: 'availability', value: 'In Stock', attribute: 'textContent', transform: 'trim' },
    { name: 'price', xpath: './/span[@class="price"]', attribute: 'textContent', transform: 'trim' },
  ],
} as unknown as ExtractionPlan;

describe('buildExtractionScript — malformed plan from LLM', () => {
  it('still extracts the well-formed fields when one field has no xpath', async () => {
    const browser = new PlaywrightBrowser();
    await browser.launch({ headless: true });
    try {
      const result = await browser.setContentEvaluate<{ data: Record<string, unknown>[] }>(
        HTML,
        buildExtractionScript(PLAN),
      );

      // The whole pass must survive — this threw before the fix.
      expect(result.data.length).toBeGreaterThan(0);
      const row = result.data[0]!;
      expect(row.title).toBe('KALLAX Shelf unit');
      expect(row.price).toBe('79.99');
      // The xpath-less field simply yields nothing here; the router falls back to
      // its AI-seen `value` with source 'ai-vision'.
      expect(row.availability).toBeUndefined();
    } finally {
      await browser.close();
    }
  }, 60_000);
});
