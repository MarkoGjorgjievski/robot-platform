// Array-typed fields must collect every matching node, not just the first.
//
// buildExtractionScript resolved every field with FIRST_ORDERED_NODE_TYPE, so a
// list field like bullet_points could only ever return one node. In practice the
// AI pointed the xpath at the containing <ul>, whose textContent is every bullet
// run together — and the executor then collapses all whitespace, destroying the
// <li> boundaries. The shape validator saw a single string, rejected it as
// "not array", and the field was dropped.
//
// Net effect: array fields were unreachable from the DOM. They only ever resolved
// when JSON-LD or an API happened to supply them. Seen on the 2026-08-18 Newegg
// dogfood, where bullet_points and specifications were both found and discarded:
//   Rejected bullet_points="PCIe 5.0 Performance: Supercharge your workflow..." : not array

import { describe, it, expect } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { buildExtractionScript } from './executor.js';
import type { ExtractionPlan } from '@robot/agent';

const HTML = `<html><body><main>
  <h1 class="title">SAMSUNG 9100 PRO 2TB</h1>
  <ul class="bullets">
    <li>PCIe 5.0 Performance</li>
    <li>Up to 14,700 MB/s sequential read</li>
    <li>Nickel-coated controller</li>
  </ul>
</main></body></html>`;

const PLAN: ExtractionPlan = {
  row_xpath: '//main',
  fields: [
    { name: 'title', xpath: './/h1[@class="title"]', attribute: 'textContent', transform: 'trim' },
    { name: 'bullet_points', xpath: './/ul[@class="bullets"]/li', attribute: 'textContent', transform: 'trim' },
  ],
  page_type: 'detail',
};

describe('buildExtractionScript — array-typed fields', () => {
  it('collects every matching node for a field declared as an array', async () => {
    const browser = new PlaywrightBrowser();
    await browser.launch({ headless: true });
    try {
      const result = await browser.setContentEvaluate<{ data: Record<string, unknown>[] }>(
        HTML,
        buildExtractionScript(PLAN, { bullet_points: 'array', title: 'string' }),
      );

      const row = result.data[0]!;
      expect(row.title).toBe('SAMSUNG 9100 PRO 2TB');
      expect(row.bullet_points).toEqual([
        'PCIe 5.0 Performance',
        'Up to 14,700 MB/s sequential read',
        'Nickel-coated controller',
      ]);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it('leaves non-array fields as single values', async () => {
    const browser = new PlaywrightBrowser();
    await browser.launch({ headless: true });
    try {
      // Same xpath, but the field is NOT declared as an array — must stay a scalar.
      const plan: ExtractionPlan = {
        row_xpath: '//main',
        fields: [{ name: 'first_bullet', xpath: './/ul[@class="bullets"]/li', attribute: 'textContent', transform: 'trim' }],
        page_type: 'detail',
      };
      const result = await browser.setContentEvaluate<{ data: Record<string, unknown>[] }>(
        HTML,
        buildExtractionScript(plan, { first_bullet: 'string' }),
      );
      expect(result.data[0]!.first_bullet).toBe('PCIe 5.0 Performance');
    } finally {
      await browser.close();
    }
  }, 60_000);
});
