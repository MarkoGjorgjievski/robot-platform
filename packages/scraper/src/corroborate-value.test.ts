import { describe, it, expect } from 'vitest';
import { visibleTextFromHtml, corroborateValue } from './corroborate-value.js';

// Trimmed from the live Newegg product page used to measure this rule.
const PAGE_HTML = `
<html>
  <head>
    <title>SAMSUNG SSD 9100 PRO 2TB, PCIe 5.0x4 M.2 2280, Seq. Read Speeds Up to 14,700MB/s - Newegg.com</title>
    <script type="application/ld+json">{"name":"SAMSUNG SSD 9100 PRO 2TB"}</script>
    <script>var config = {"name":"Similar Seller Recommendation on OrderTracking and ProductList page"};</script>
    <style>.x { color: red }</style>
  </head>
  <body>
    <h1>SAMSUNG SSD 9100 PRO 2TB, PCIe 5.0x4 M.2 2280, Seq. Read Speeds Up to 14,700MB/s, Best for AI Computing, Gaming, and Heavy Duty Workstations (MZ- VAP2T0B/AM)</h1>
    <div class="brand">SAMSUNG</div>
    <div class="reviews">(1,144) reviews</div>
    <div class="price">$402.99</div>
  </body>
</html>`;

const pageText = visibleTextFromHtml(PAGE_HTML);

/** The real value the pipeline should keep. */
const GOOD_NAME =
  'SAMSUNG SSD 9100 PRO 2TB, PCIe 5.0x4 M.2 2280, Seq. Read Speeds Up to 14,700MB/s, Best for AI Computing, Gaming, and Heavy Duty Workstations (MZ- VAP2T0B/AM)';
/** The Newegg internal feature-flag label that poisoned the cache on 2026-08-18. */
const BAD_CONFIG_LABEL = 'Similar Seller Recommendation on OrderTracking and ProductList page';

describe('visibleTextFromHtml', () => {
  it('drops script and style content so inline JSON cannot corroborate itself', () => {
    expect(pageText).toContain('SAMSUNG SSD 9100 PRO 2TB');
    expect(pageText.toLowerCase()).not.toContain('similar seller recommendation');
    expect(pageText).not.toContain('color: red');
  });

  it('keeps the document title', () => {
    expect(pageText).toContain('Newegg.com');
  });
});

describe('corroborateValue', () => {
  it('rejects an API value that appears nowhere in the rendered page', () => {
    const r = corroborateValue({ value: BAD_CONFIG_LABEL, fieldName: 'product_name', source: 'api', pageText });
    expect(r.ok).toBe(false);
  });

  it('rejects the otFlat cache-poisoning value', () => {
    const r = corroborateValue({ value: 'otFlat', fieldName: 'product_name', source: 'api-ai', pageText });
    expect(r.ok).toBe(false);
  });

  it('accepts the real product name from the same API source', () => {
    const r = corroborateValue({ value: GOOD_NAME, fieldName: 'product_name', source: 'api', pageText });
    expect(r.ok).toBe(true);
  });

  it('accepts a page-truncated rendering of a long name', () => {
    // The page shows a shortened title; overlap stays well above threshold.
    const r = corroborateValue({
      value: 'SAMSUNG SSD 9100 PRO 2TB, PCIe 5.0x4 M.2 2280, Seq. Read Speeds Up to 14,700MB/s',
      fieldName: 'product_name', source: 'api', pageText,
    });
    expect(r.ok).toBe(true);
  });

  it('accepts a brand that is present', () => {
    expect(corroborateValue({ value: 'SAMSUNG', fieldName: 'brand', source: 'api', pageText }).ok).toBe(true);
  });

  // --- Scope guards: everything below must pass through untouched ---

  it('ignores page-derived sources — corroborating the page against itself is circular', () => {
    for (const source of ['json-ld', 'meta', 'xpath', 'xpath-cached', 'human'] as const) {
      expect(corroborateValue({ value: BAD_CONFIG_LABEL, fieldName: 'product_name', source, pageText }).ok).toBe(true);
    }
  });

  it('ignores fields that are not name-like — numbers get reformatted on the page', () => {
    // API says 1144, the page renders "(1,144)". Verbatim-ish matching would be wrong here.
    expect(corroborateValue({ value: 1144, fieldName: 'review_count', source: 'api', pageText }).ok).toBe(true);
    // Internal item numbers legitimately never appear.
    expect(corroborateValue({ value: '9SIC0X3KPS7946', fieldName: 'sku', source: 'api', pageText }).ok).toBe(true);
  });

  it('ignores non-string values', () => {
    expect(corroborateValue({ value: 42, fieldName: 'product_name', source: 'api', pageText }).ok).toBe(true);
    expect(corroborateValue({ value: ['a'], fieldName: 'product_name', source: 'api', pageText }).ok).toBe(true);
  });

  it('passes short values through — too few tokens to score honestly', () => {
    // A two-letter brand like "LG" yields no scoreable tokens; guessing would
    // reject real data, so the rule declines to judge.
    expect(corroborateValue({ value: 'LG', fieldName: 'brand', source: 'api', pageText }).ok).toBe(true);
  });

  it('declines to judge when no page text was captured', () => {
    expect(corroborateValue({ value: BAD_CONFIG_LABEL, fieldName: 'product_name', source: 'api', pageText: '' }).ok).toBe(true);
  });
});
