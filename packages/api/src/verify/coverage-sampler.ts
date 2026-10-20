// Which products the coverage check reads (spec 2026-10-10 §A2, D1): the
// listing's product group minus the proof pages, twenty of them spread evenly
// over the listing's order so the top of the page (colourways, sponsored
// strips) does not fill the sample.
import { productKey } from '@robot/scraper';

export const COVERAGE_SAMPLE_SIZE = 20;

/** Spec 2026-10-20 §3.4, §5.5: one product is one key (`productKey`) — a query (other than an id-like one on a literal path), a fragment, `www.` or a trailing slash never makes another, so a proof page is never sampled under any of them. */
const key = (u: string) => productKey(u) ?? u.replace(/#.*$/, '').replace(/\/+$/, '');

export function sampleListing(productUrls: string[], proofUrls: string[], max = COVERAGE_SAMPLE_SIZE): string[] {
  const proof = new Set(proofUrls.map(key));
  const seen = new Set<string>();
  const pool = productUrls.filter((u) => { const k = key(u); if (proof.has(k) || seen.has(k)) return false; seen.add(k); return true; });
  if (pool.length <= max) return pool;
  // The first link first, then evenly over the whole list: 25 links give every 1.25th, not the first
  // twenty (a constant step of floor(n / 20) would take the top 20 of 21–39 links, the top 40 of 59).
  return Array.from({ length: max }, (_, i) => pool[Math.floor((i * pool.length) / max)]!);
}
