// CLI: Jev at Verify, in shadow — how often Jev agreed with what customers verified (spec 2026-10-16 §7).
// Reads verify_agreement only; free, no DB writes.
//   pnpm --filter @robot/api exec tsx src/jev-agreement.ts [--since 2026-10-16]
import { and, gte, isNotNull } from 'drizzle-orm';
import { db, sourceVerifications } from '@robot/db';
import type { JevAgreement } from './verify/jev-agreement.js';

const sinceArg = process.argv.indexOf('--since');
const since = sinceArg > 0 ? new Date(process.argv[sinceArg + 1] ?? '') : new Date(0);
if (Number.isNaN(since.getTime())) {
  console.error('--since takes a date, e.g. --since 2026-10-16');
  process.exit(1);
}
const rows = await db.query.sourceVerifications.findMany({
  where: and(isNotNull(sourceVerifications.verifyAgreement), gte(sourceVerifications.startedAt, since)),
  columns: { id: true, sourceId: true, verifyAgreement: true },
});
type Tally = { asked: number; agreed: number };
const buckets = new Map<string, Tally>();
const byField = new Map<string, Tally>();
const variants: Tally = { asked: 0, agreed: 0 };
const disagreements: string[] = [];
const count = (map: Map<string, Tally>, k: string, agree: boolean) => {
  const x = map.get(k) ?? { asked: 0, agreed: 0 };
  x.asked++;
  if (agree) x.agreed++;
  map.set(k, x);
};
for (const r of rows) {
  const a = r.verifyAgreement as JevAgreement;
  for (const [url, page] of Object.entries(a.pages)) {
    for (const [key, c] of Object.entries(page.fields)) {
      count(buckets, c.p >= 0.9 ? '≥ 0.9' : c.p >= 0.8 ? '0.8–0.9' : c.p >= 0.6 ? '0.6–0.8' : '< 0.6', c.agree);
      count(byField, key, c.agree);
      if (!c.agree) disagreements.push(`${r.sourceId} ${key} ${url}: Jev ${c.value ?? 'none'} (${c.p.toFixed(2)}) · verified ${c.expected}${c.certified === undefined ? '' : c.certified ? ' · certified' : ' · not certified'}`);
    }
    if (page.variant) {
      variants.asked++;
      if (page.variant.agree) variants.agreed++;
      else disagreements.push(`${r.sourceId} variant ${url}: Jev ${page.variant.pick} · [page] ${page.variant.pageMatch ?? 'nothing'}`);
    }
  }
}
const line = (k: string, x: Tally) => `  ${k}: ${x.agreed} of ${x.asked} (${x.asked ? Math.round((100 * x.agreed) / x.asked) : 0}%)`;
console.log(`${rows.length} verifications with readings since ${since.toISOString().slice(0, 10)}`);
console.log('By probability:'); for (const [k, x] of buckets) console.log(line(k, x));
console.log('By field:'); for (const [k, x] of byField) console.log(line(k, x));
console.log('Variant vs [page]:'); console.log(line('selected variant', variants));
console.log(`Disagreements (${disagreements.length}):`); for (const d of disagreements.slice(0, 50)) console.log(`  ${d}`);
process.exit(0);
