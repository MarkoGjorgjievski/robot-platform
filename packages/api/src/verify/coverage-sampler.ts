// Which products the coverage check reads (spec 2026-10-10 §A2, D1): the
// listing's product group minus the proof pages, twenty of them spread evenly
// over the listing's order so the top of the page (colourways, sponsored
// strips) does not fill the sample.
export const COVERAGE_SAMPLE_SIZE = 20;

const key = (u: string) => u.replace(/#.*$/, '').replace(/\/+$/, '');

export function sampleListing(productUrls: string[], proofUrls: string[], max = COVERAGE_SAMPLE_SIZE): string[] {
  const proof = new Set(proofUrls.map(key));
  const seen = new Set<string>();
  const pool = productUrls.filter((u) => { const k = key(u); if (proof.has(k) || seen.has(k)) return false; seen.add(k); return true; });
  if (pool.length <= max) return pool;
  const k = Math.floor(pool.length / max);
  const out: string[] = [];
  for (let i = 0; i < pool.length && out.length < max; i += k) out.push(pool[i]!);
  return out;
}
