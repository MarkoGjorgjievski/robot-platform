// A free live check: reachability and the listing check on real public pages, through an in-process
// worker on its own queue. Page loads only — no key, no Jev. Exits 1 when a page could not be read.
//   cd packages/worker && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= npx tsx src/live-check.ts [url …]
import { randomUUID } from 'node:crypto';
process.env.JOB_QUEUE = `live-check-${randomUUID()}`;
process.env.ANTHROPIC_API_KEY = '';
process.env.JEV_SHADOW = '';
process.env.TYPESAFE_API_KEY = '';

const { readWorkerConfig } = await import('./config.js');
const { startWorker } = await import('./worker.js');
const { runAndWait } = await import('@robot/api/jobs');
const { db } = await import('@robot/db');
const { sql } = await import('drizzle-orm');

// The shapes of `Reachability` (verify/reachability.ts) and `ListingPageCheck` (verify/find-product-pages.ts), as far as read here.
type Reach = { verdict: { kind: string }; message: string; finalUrl: string | null; ms: number; waitMs?: number };
type Listing = { verdict: { kind: string }; message: string | null; productLinks: number; pagerSeen: boolean; sample: string[] };

const urls = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [
  'https://books.toscrape.com/',
  'https://webscraper.io/test-sites/e-commerce/allinone/computers/laptops',
  'https://www.allbirds.com/collections/mens',
];
const worker = await startWorker({ ...readWorkerConfig(process.env), websiteChecks: false });
let bad = 0;
try {
  for (const url of urls) {
    const reach = (await runAndWait('reachability', { url })) as Reach;
    const listing = (await runAndWait('listing-check', { listingUrl: url })) as Listing;
    console.log(`${url}\n  reachability: ${reach.verdict.kind} in ${reach.ms} ms → ${reach.finalUrl ?? '-'} — ${reach.message}`
      + `\n  listing: ${listing.verdict.kind}; ${listing.productLinks} product links; pager ${listing.pagerSeen ? 'seen' : 'not seen'}; sample ${listing.sample.slice(0, 2).join(', ') || '-'}${listing.message ? ` — ${listing.message}` : ''}`);
    if (reach.verdict.kind !== 'ok' || listing.message) bad++;
  }
} finally {
  await worker.stop();
  console.log(`browsers open after stop: ${worker.gate.open()}`);
  await db.execute(sql`DELETE FROM jobs WHERE queue = ${process.env.JOB_QUEUE!}`);
}
process.exit(bad === 0 ? 0 : 1);
