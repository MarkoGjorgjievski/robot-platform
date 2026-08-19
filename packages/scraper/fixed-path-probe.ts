// THROWAWAY — confirms or kills the "one page, many prices" premise in docs/ideas.md.
// Captures the same URL repeatedly reading FIXED dot-paths, so extraction-path
// variance is held constant and anything that moves is the page itself.
import { PlaywrightBrowser } from '@robot/browser';
import { getByDotPath } from './src/domain-cache.js';
import { visibleTextFromHtml } from './src/corroborate-value.js';

const URL_ = 'https://www.newegg.com/samsung-2tb-9100-pro-nvme-2-0/p/N82E16820147903';
const N = Number(process.env.N ?? 8);
const GAP_MS = Number(process.env.GAP_MS ?? 45_000);

const PATHS = [
  'MainItem.OriginalUnitPrice',
  'MainItem.FinalPrice',
  'MainItem.LowestPrice30Days',
  'MainItem.ItemPriceRange.PriceRangeMin',
  'MainItem.Seller.SellerName',
  'MainItem.Seller.SellerId',
  'MainItem.Seller.SellerRatingOneDecimal',
  'MainItem.Review.RatingOneDecimal',
];

type Row = { t: string; api: string; vals: Record<string, unknown>; visible: string };
const rows: Row[] = [];

for (let i = 0; i < N; i++) {
  const b = new PlaywrightBrowser();
  await b.launch({ headless: true });
  try {
    const cap = await b.capture(URL_, { waitUntil: 'networkidle', interceptNetworkRequests: true });
    const realtime = cap.interceptedRequests.find((r) => /ProductRealtime/i.test(r.url));
    const vals: Record<string, unknown> = {};
    for (const p of PATHS) vals[p] = realtime ? getByDotPath(realtime.parsedJson, p) : undefined;
    const text = visibleTextFromHtml(cap.html ?? '');
    const m = text.match(/\$[0-9][0-9,]*\.[0-9]{2}/g) ?? [];
    rows.push({
      t: new Date().toISOString().slice(11, 19),
      api: realtime ? 'ProductRealtime' : 'MISSING',
      vals,
      visible: [...new Set(m)].slice(0, 4).join(' '),
    });
    console.log(`[${i + 1}/${N}] ${rows.at(-1)!.t} seller=${vals['MainItem.Seller.SellerName']} price=${vals['MainItem.OriginalUnitPrice']} visible=${rows.at(-1)!.visible}`);
  } catch (e) {
    console.log(`[${i + 1}/${N}] ERROR ${(e as Error).message.split('\n')[0].slice(0, 70)}`);
  } finally { await b.close(); }
  if (i < N - 1) await new Promise((r) => setTimeout(r, GAP_MS));
}

console.log('\n=== distinct values per fixed path ===');
for (const p of PATHS) {
  const seen = [...new Set(rows.map((r) => JSON.stringify(r.vals[p])))];
  console.log(`${seen.length > 1 ? 'VARIES ' : 'stable '} ${p.padEnd(42)} ${seen.join('  |  ')}`);
}
const vis = [...new Set(rows.map((r) => r.visible))];
console.log(`${vis.length > 1 ? 'VARIES ' : 'stable '} (visible prices on page)${' '.repeat(18)}${vis.join('  |  ')}`);
console.log(`\ncaptures: ${rows.length}/${N}`);
