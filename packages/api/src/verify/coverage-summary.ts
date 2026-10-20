// From a coverage check's row to what the Verification tab says (spec
// 2026-10-10 §A5): per field, the sampled pages it was empty on, one
// explanation from a fixed vocabulary when at least four of five of them share
// a shape feature none of the proof pages has, and the page to offer as the
// next proof page. Pure: the row in, strings out.
import { urlShape, type Shape } from '@robot/scraper';

export type SampledPage = { url: string; empty: string[]; shape: Shape } | { url: string; unread: string };
/**
 * `noProducts`: the listing had no products at all (spec 2026-10-20 §3.6), so nothing was sampled.
 * `allProofPages`: it had products, every one of them already a proof page (final review M5), so nothing was sampled.
 */
export type CoverageResults = { listingUrl: string; sampled: SampledPage[]; proofShapes: Record<string, Shape>; planned?: number; noProducts?: true; allProofPages?: true };
/** `answered`: every empty page's address shape has a proof page marked "Not on this product" for this field (spec 2026-10-20 §3.8) — nothing to offer, `representative` is null. */
export type FieldCoverage = { key: string; empty: string[]; sampled: number; unread: number; explanation: string | null; representative: string | null; answered?: true };

type Read = Extract<SampledPage, { shape: Shape }>;
const isRead = (p: SampledPage): p is Read => 'shape' in p;

/** A feature a page may have, the test for it, and its sentence in the plural ("all n …" / "n of m …") and the singular. */
type Feature = { id: string; has: (s: Shape) => boolean; plural: string; singular: string };
const FEATURES: Feature[] = [
  { id: 'in-variants', has: (s) => s.offers === 'in-variants', plural: 'list their sizes as variants in the page data', singular: 'lists its sizes as variants in the page data' },
  { id: 'no-offer', has: (s) => s.offers === 'none', plural: 'have no offer in the page data', singular: 'has no offer in the page data' },
  { id: 'no-rating', has: (s) => s.rating === false, plural: 'show no rating in the page data', singular: 'shows no rating in the page data' },
  { id: 'not-product', has: (s) => !s.jsonLdTypes.includes('Product'), plural: 'do not describe themselves as a product in the page data', singular: 'does not describe itself as a product in the page data' },
];
const SHARE = 0.8;

function explain(empties: Read[], proof: Shape[]): string | null {
  const n = empties.length;
  if (n === 0) return null;
  const candidates: Array<{ count: number; text: string }> = [];
  for (const f of FEATURES) {
    // No proof shapes to compare against: no feature can be shown to be the difference.
    if (proof.length === 0 || proof.some(f.has)) continue;          // a proof page has it too: not the difference
    const count = empties.filter((p) => f.has(p.shape)).length;
    if (count / n < SHARE) continue;
    candidates.push({ count, text: n === 1 ? `it ${f.singular}` : count === n ? `all ${n} ${f.plural}` : `${count} of ${n} ${f.plural}` });
  }
  // The address pattern: every empty page shares one the proof pages do not use.
  const addresses = new Set(empties.map((p) => p.shape.address));
  if (addresses.size === 1 && proof.length > 0 && !proof.some((s) => s.address === [...addresses][0])) {
    const a = [...addresses][0]!;
    candidates.push({ count: n, text: n === 1 ? `its address looks like ${a}` : `all ${n} have addresses like ${a}` });
  }
  candidates.sort((x, y) => y.count - x.count);
  return candidates[0]?.text ?? null;
}

/** The first empty page of the largest group of identical shapes (ties: the earlier page). */
function representative(empties: Read[]): string | null {
  if (empties.length === 0) return null;
  const groups = new Map<string, Read[]>();
  for (const p of empties) { const k = JSON.stringify(p.shape); (groups.get(k) ?? groups.set(k, []).get(k)!).push(p); }
  let best: Read[] = [];
  for (const g of groups.values()) if (g.length > best.length) best = g;
  return best[0]!.url;
}

/**
 * Per field, the sampled pages it was empty on. `absentShapes`: field key → the address shapes
 * (`urlShape`) of the proof pages marked "Not on this product" for it. An empty page of such a
 * shape is already answered (spec 2026-10-20 §3.8): it is never the page offered as the next
 * proof page; when every empty page is, the field is `answered` and nothing is offered.
 */
export function summariseCoverage(results: CoverageResults, fieldKeys: string[], absentShapes: Record<string, string[]> = {}): FieldCoverage[] {
  const read = results.sampled.filter(isRead);
  const unread = results.sampled.length - read.length;
  const proof = Object.values(results.proofShapes);
  const out: FieldCoverage[] = [];
  for (const key of fieldKeys) {
    const empties = read.filter((p) => p.empty.includes(key));
    if (empties.length === 0) continue;
    const answered = new Set(absentShapes[key] ?? []);
    const open = empties.filter((p) => { const s = urlShape(p.url); return s === null || !answered.has(s); });
    out.push({
      key, empty: empties.map((p) => p.url), sampled: read.length, unread, explanation: explain(empties, proof), representative: representative(open),
      ...(open.length === 0 ? { answered: true as const } : {}),
    });
  }
  return out;
}

/** A coverage check that ran past its window (spec 2026-10-20 §3.5.5); a superseded one says nothing (a newer check replaced it). */
export const COVERAGE_STALLED = 'The check took too long and stopped. It runs again after your next Verify.';

/** A listing with no products (spec 2026-10-20 §3.6): the check samples nothing and says so. */
export const NO_PRODUCTS_ON_LISTING = 'No products found on the listing page, so no more products were checked.';

/** A listing whose every product is already a proof page: nothing is left to sample, and the check says so rather than nothing. */
export const ALL_PROOF_PAGES = 'Every product on the listing page is already a proof page, so no more products were checked.';

/** The done line when every field with empties is answered "Not on this product" by a proof page of that shape (spec 2026-10-20 §3.8). */
export const ALL_ANSWERED = 'every field was found, except where a proof page says "Not on this product".';

/**
 * The verify bar's coverage stage line. `fieldsWithEmpties` counts only the open fields — an
 * `answered` one (spec 2026-10-20 §3.8) is not empty in any way the customer can act on, so it is
 * never sent to "see the row"; `answeredFields` counts those, so a check whose only empties are
 * answered says so instead of "every field was found".
 */
export function stageLine(status: 'running' | 'done' | 'failed', results: CoverageResults | null, fieldsWithEmpties: number, error: string | null, answeredFields = 0): string | null {
  if (status === 'failed') return error;
  if (status === 'running') {
    // Before the listing is read there is nothing to count yet: nothing is shown.
    const n = results?.planned ?? results?.sampled.length ?? 0;
    return n === 0 ? null : `Checking ${n} more products from the listing…`;
  }
  if (results?.noProducts) return NO_PRODUCTS_ON_LISTING;
  if (results?.allProofPages) return ALL_PROOF_PAGES;
  const n = results?.sampled.length ?? 0;
  if (n === 0) return null;
  const read = results!.sampled.filter(isRead).length;
  const products = n === 1 ? 'product' : 'products';
  // Nothing read (a wall from the first page, say): there is nothing to say about any field.
  if (read === 0) return `Checked ${n} more ${products} from the listing: none could be read.`;
  if (fieldsWithEmpties === 0) {
    const unread = n - read;
    const found = answeredFields > 0 ? ALL_ANSWERED : 'every field was found on all of them.';
    return `Checked ${n} more ${products} from the listing: ${found}${unread > 0 ? ` (${unread} could not be read)` : ''}`;
  }
  const fields = fieldsWithEmpties === 1 ? '1 field was' : `${fieldsWithEmpties} fields were`;
  return `${fields} empty on some of the ${read} sampled ${read === 1 ? 'product' : 'products'} — see the ${fieldsWithEmpties === 1 ? 'row' : 'rows'}.`;
}
