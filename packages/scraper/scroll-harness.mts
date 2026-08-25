/**
 * THROWAWAY: drives the REAL PlaywrightBrowser.scrollPages against a live URL
 * with no AI, no database and no plan pipeline, so a scroll walk can be watched
 * for free and as often as it takes.
 *
 * Written for the 2026-08-25 question the audit trail could not answer: the
 * walk yields three rounds (36/36/4) against a page holding ~221 products and
 * then stops, and the trail only records rounds that YIELDED — never the quiet
 * round that actually ends the walk.
 *
 * Run with SCROLL_DEBUG=1 to get the generator's own per-round line.
 *
 * Delete once the early stop is understood and covered by a fixture test.
 */
import { PlaywrightBrowser } from './../browser/src/playwright-browser.js';
import { buildExtractionScript } from './src/executor.js';

const URL = process.argv[2] ?? 'https://www.uniqlo.com/us/en/men/tops';

// Matches the tiles the live run's cached field path pointed at
// (`.//a[contains(@class,"product-tile__link")]/@href`), so the row set this
// walks is the one production walked.
const ROW_XPATH = "//a[contains(@class,'product-tile__link')]";

const plan = {
  page_type: 'listing',
  row_xpath: ROW_XPATH,
  fields: [{ name: 'detail_url', xpath: '@href', attribute: 'href' }],
} as unknown as Parameters<typeof buildExtractionScript>[0];

const script = buildExtractionScript(plan, { detail_url: 'url' }, URL);

const browser = new PlaywrightBrowser();
await browser.launch({ headless: process.env.HEADFUL !== '1' });

const seen = new Set<string>();
let rounds = 0;
const started = Date.now();

try {
  for await (const round of browser.scrollPages(URL, { extractionScript: script, rowXpath: ROW_XPATH })) {
    rounds++;
    const urls = round.data.map((r) => String(r.detail_url ?? '')).filter(Boolean);
    const fresh = urls.filter((u) => !seen.has(u));
    for (const u of urls) seen.add(u);
    console.log(
      `[harness] YIELD round=${round.pageNumber} rows=${round.data.length} ` +
      `totalRows=${round.totalRows} new=${fresh.length} cumulative=${seen.size} ` +
      `t=${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
  }
} finally {
  await browser.close();
}

console.log(`\n[harness] DONE — ${rounds} rounds yielded, ${seen.size} distinct urls, ${((Date.now() - started) / 1000).toFixed(1)}s`);
