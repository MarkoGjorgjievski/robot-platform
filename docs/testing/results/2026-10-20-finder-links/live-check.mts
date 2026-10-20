// The free live check for spec 2026-10-20 §6: the finder's real code over the 13 listing pages of
// the harvests, before (the rule on `main` before this branch: one capture, the HTML read offline,
// `largestProductGroup`) and after (this branch: `readListingPage` with the bounded loading, then
// `findProductGroup`). One Chromium, one page at a time. No model, no database, no server.
// Writes live-check.md and the after capture's first screenshot tile per site (live/<site>.png).
//
// Run from packages/scraper, so `@robot/*` resolve:
//   npx tsx ../../docs/testing/results/2026-10-20-finder-links/live-check.mts [site …]
// BEFORE_ROOT: a checkout whose packages/scraper still has the old rule (default: the main checkout).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PlaywrightBrowser } from '../../../../packages/browser/src/index.ts';
import { readListingPage } from '../../../../packages/scraper/src/crawl/read-listing.ts';
import { findProductGroup } from '../../../../packages/scraper/src/crawl/product-link-group.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'live');
const BEFORE_ROOT = process.env.BEFORE_ROOT ?? 'C:/Users/Marko/Documents/projects/robot-platform';

/** The 13 harvest URLs (probe2.mts) and what the spec's §2 table counted on each page. */
const SITES: Array<{ site: string; url: string; onPage: string }> = [
  { site: 'bombas', url: 'https://bombas.com/collections/mens-socks', onPage: '27 /products/*' },
  { site: 'burrow', url: 'https://burrow.com/collections/sofas', onPage: '25' },
  { site: 'thomann-cat', url: 'https://www.thomann.de/de/gitarren_baesse.html', onPage: 'a category hub (99 acceptable, §7)' },
  { site: 'thomann', url: 'https://www.thomann.de/de/4-4_konzertgitarren.html', onPage: '51 (/de/*.htm)' },
  { site: 'lacoste', url: 'https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/', onPage: '13' },
  { site: 'ikea', url: 'https://www.ikea.com/my/en/cat/sofas-fu003/', onPage: '52 priced cards' },
  { site: 'ikea-blog', url: 'https://www.ikea.com/global/en/stories/ideas-inspiration/style-report-modern-nordic-warmth-260617/', onPage: '0' },
  { site: 'noths', url: 'https://www.notonthehighstreet.com/sale/jewellery-sale', onPage: '60 /{seller}/product/*' },
  { site: 'ruggable', url: 'https://ruggable.com/collections/shop-all', onPage: '47' },
  { site: 'skullcandy', url: 'https://www.skullcandy.com/collections/shop-all', onPage: '41' },
  { site: 'puma', url: 'https://us.puma.com/us/en/men/shoes', onPage: '14' },
  { site: 'gymshark', url: 'https://www.gymshark.com/collections/all-products/womens', onPage: 'colours are separate pages (§7)' },
  { site: 'ridge', url: 'https://ridge.com/collections/wallets', onPage: '0' },
];

type Before = { n: number; paths: number; examples: string[] } | { verdict: string } | { error: string } | { skipped: string };
type After = { n: number; carded: number; shape: string | null; examples: string[]; verdict: string; finalUrl: string; anchors: number; itemList: number; ms: number } | { error: string };
const msg = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0]!.slice(0, 200);
const pathOf = (u: string) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };

const pick = process.argv.slice(2);
const sites = SITES.filter((s) => pick.length === 0 || pick.includes(s.site));
mkdirSync(OUT, { recursive: true });

let old: { largestProductGroup: (a: unknown[], u: string) => string[]; LISTING_ANCHORS_SCRIPT: string } | null = null;
try {
  const mod = await import(pathToFileURL(join(BEFORE_ROOT, 'packages/scraper/src/crawl/product-link-group.ts')).href);
  if (typeof mod.largestProductGroup === 'function' && typeof mod.LISTING_ANCHORS_SCRIPT === 'string') old = mod;
} catch (e) { console.warn(`[live-check] no old rule at ${BEFORE_ROOT}: ${msg(e)}`); }

const browser = new PlaywrightBrowser();
await browser.launch({ headless: true });
const rows: Array<{ site: string; url: string; onPage: string; before: Before; after: After }> = [];
try {
  for (const { site, url, onPage } of sites) {
    let before: Before = { skipped: 'old rule not found' };
    if (old) {
      try {
        const cap = await browser.capture(url, { waitUntil: 'networkidle', interceptNetworkRequests: false, timeout: 20_000, maxTiles: 1 });
        if (cap.verdict.kind === 'ok') {
          const anchors = await browser.setContentEvaluate<unknown[]>(cap.html, old.LISTING_ANCHORS_SCRIPT);
          const group = old.largestProductGroup(anchors, url);
          before = { n: group.length, paths: new Set(group.map((u) => new URL(u).pathname)).size, examples: group.slice(0, 3).map(pathOf) };
        } else before = { verdict: cap.verdict.kind };
      } catch (e) { before = { error: msg(e) }; }
    }
    let after: After;
    try {
      const t0 = Date.now();
      const { capture, links } = await readListingPage(browser, url, { load: true, timeout: 20_000 });
      const group = findProductGroup(links, url);
      writeFileSync(join(OUT, `${site}.png`), capture.screenshot);
      after = {
        n: group?.urls.length ?? 0, carded: group?.carded ?? 0, shape: group?.shape ?? null, examples: (group?.urls ?? []).slice(0, 3).map(pathOf),
        verdict: capture.verdict.kind, finalUrl: capture.url, anchors: links.anchors.length, itemList: links.itemList.length, ms: Date.now() - t0,
      };
    } catch (e) { after = { error: msg(e) }; }
    rows.push({ site, url, onPage, before, after });
    console.log(JSON.stringify({ site, before, after }));
  }
} finally {
  await browser.close();
}

const cell = (b: Before) => ('n' in b ? `${b.n} links / ${b.paths} paths` : 'verdict' in b ? `verdict ${b.verdict}` : 'error' in b ? `error: ${b.error}` : b.skipped);
const cellAfter = (a: After) => ('error' in a ? `error: ${a.error}` : a.verdict !== 'ok' ? `verdict ${a.verdict}` : a.n === 0 ? '**no products**' : `${a.n} (${a.carded} on cards)`);
const lines = [
  '# The finder reads product links — free live check',
  '',
  `Run ${new Date().toISOString()} by \`live-check.mts\` (this folder): one Chromium, one page at a time, no model. Before: the rule on \`main\` before this branch (${old ? BEFORE_ROOT : 'not found'}). After: \`readListingPage\` (bounded loading) + \`findProductGroup\`. Screenshots: \`live/<site>.png\` (the zero cases are committed).`,
  '',
  '| Site | Products on the page (spec §2) | Finder before | Finder after | Shape after | First products after | ms |',
  '|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.site} | ${r.onPage} | ${cell(r.before)} | ${cellAfter(r.after)} | ${'shape' in r.after ? `\`${r.after.shape ?? 'ItemList'}\`` : ''} | ${'examples' in r.after ? r.after.examples.map((e) => `\`${e}\``).join('<br>') : ''} | ${'ms' in r.after ? r.after.ms : ''} |`),
  '',
  '## Before, first links',
  '',
  ...rows.map((r) => `- ${r.site}: ${'examples' in r.before ? r.before.examples.map((e) => `\`${e}\``).join(', ') : cell(r.before)}`),
  '',
  '## Zero cases (screenshots looked at)',
  '',
  ...rows.filter((r) => !('error' in r.after) && r.after.n === 0).map((r) => `- ${r.site} — \`live/${r.site}.png\`; final URL ${'finalUrl' in r.after ? r.after.finalUrl : ''}; ${'anchors' in r.after ? `${r.after.anchors} links, ${r.after.itemList} ItemList items` : ''}. LOOKED: (fill in what the screenshot shows)`),
  '',
  '## Raw',
  '',
  '```json',
  JSON.stringify(rows, null, 2),
  '```',
  '',
];
writeFileSync(join(HERE, 'live-check.md'), lines.join('\n'));
console.log(`wrote ${join(HERE, 'live-check.md')}`);
