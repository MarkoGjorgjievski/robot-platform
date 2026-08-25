/**
 * THROWAWAY diagnostic for Task 6, Step 1 of the dom-scroll plan.
 *
 * The api-param live proof failed because its target was chosen from a roadmap
 * note rather than from evidence — Newegg renders its grid server-side, so the
 * strategy never got a candidate to try. This answers the one question that
 * matters before any money is spent: on THIS url, does scrolling actually add
 * products?
 *
 * Free: no LLM, no database, no extraction. Just a browser and a row count.
 *
 * Delete after Task 6. Not part of the build, not imported by anything.
 */
import { chromium } from 'playwright';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

async function stealthChromium(): Promise<typeof chromium> {
  try {
    const [{ chromium: extra }, { default: StealthPlugin }] = await Promise.all([
      import('playwright-extra'),
      import('puppeteer-extra-plugin-stealth'),
    ]);
    (extra as any).use((StealthPlugin as any)());
    return extra as unknown as typeof chromium;
  } catch (err) {
    console.warn(`[probe] stealth unavailable: ${(err as Error).message}`);
    return chromium;
  }
}

/**
 * Counts product-ish links rather than a guessed card selector: a detail URL is
 * what planRun actually enumerates, so this measures the same thing the walk
 * would gain. Deduped by href, because a card that links its image and its
 * title separately is one product, not two.
 */
const COUNT_SCRIPT = `(() => {
  const hrefs = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    if (/\\/(p|product|dp|prod|item|products)\\/|\\/p-|-p-|\\.html$|\\/gp\\/product\\//i.test(href)) hrefs.add(href.split('?')[0]);
  }
  return {
    productLinks: hrefs.size,
    allLinks: document.querySelectorAll('a[href]').length,
    height: document.body.scrollHeight,
  };
})()`;

const ROUNDS = Number(process.env.ROUNDS ?? 6);
const PAUSE_MS = Number(process.env.PAUSE_MS ?? 2500);

async function probe(url: string) {
  const launcher = await stealthChromium();
  const browser = await launcher.launch({ headless: process.env.HEADFUL !== '1' });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: DEFAULT_USER_AGENT,
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3000);

    // Best-effort consent dismissal. Not the production dismissPopups — this is
    // a diagnostic, and a banner that survives will show up as a flat series.
    for (const label of ['Accept', 'Accept all', 'Accept All', 'I agree', 'Agree', 'Got it', 'OK', 'Allow all']) {
      const btn = page.getByRole('button', { name: label, exact: false }).first();
      if (await btn.count().catch(() => 0)) {
        await btn.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(800);
        break;
      }
    }

    const title = await page.title().catch(() => '(no title)');
    console.log(`\n=== ${url}`);
    console.log(`    title: ${title}`);

    const series: number[] = [];
    for (let i = 0; i <= ROUNDS; i++) {
      const m = (await page.evaluate(COUNT_SCRIPT)) as { productLinks: number; allLinks: number; height: number };
      series.push(m.productLinks);
      console.log(`    round ${i}: productLinks=${m.productLinks}  allLinks=${m.allLinks}  height=${m.height}`);
      if (i === ROUNDS) break;
      // Up-then-down, the trigger the production walk uses: scrollTo(bottom)
      // alone stalls after one batch because the page is already at the bottom.
      await page.evaluate('window.scrollTo(0, 0); window.scrollTo(0, document.body.scrollHeight);');
      await page.waitForTimeout(PAUSE_MS);
    }

    const grew = series[series.length - 1] > series[0];
    console.log(`    SERIES ${JSON.stringify(series)}  ->  ${grew ? 'GROWS ON SCROLL' : 'flat — not a scroll target'}`);
    return { url, title, series, grew };
  } catch (err) {
    console.log(`\n=== ${url}\n    FAILED: ${(err as Error).message}`);
    return { url, title: '(failed)', series: [], grew: false };
  } finally {
    await browser.close().catch(() => {});
  }
}

const urls = process.argv.slice(2);
if (!urls.length) {
  console.error('usage: tsx scroll-probe.mts <url> [url...]');
  process.exit(1);
}

const results = [];
for (const u of urls) results.push(await probe(u));

console.log('\n\n===== SUMMARY =====');
for (const r of results) {
  console.log(`${r.grew ? 'GROWS ' : 'flat  '} ${JSON.stringify(r.series).padEnd(34)} ${r.url}`);
}
