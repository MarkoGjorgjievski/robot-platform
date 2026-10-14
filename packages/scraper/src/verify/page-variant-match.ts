// packages/scraper/src/verify/page-variant-match.ts
// Does an array entry describe the page's variant? (spec 2026-10-14 §5.)
// Three rules, any one suffices; the `[page]` step succeeds only when exactly
// one entry matches. Never reads a price or an availability.
import { normalizeLabel, type PageVariant } from '@robot/browser';

export type PathContext = { pageVariant?: PageVariant };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);

const ID_KEYS = ['id', 'variant_id', 'variantId', 'productID'] as const;
const URL_KEYS = ['url', '@id'] as const;
const LABEL_KEYS = ['size', 'color', 'colour', 'option1', 'option2', 'option3'] as const;
const NAME_KEYS = ['name', 'title'] as const;
const MIN_CONTAINED = 3;
/** Keys that carry a price, a stock level or an availability: never read for matching (spec §11 property 3). */
const NEVER_READ = /price|availab|stock|inventory|quantity|offers/i;

/** The variant id an entry carries: its id keys, or `variant=`/`id=` in its url or @id, relative urls included. */
function entryIds(entry: Obj): string[] {
  const out: string[] = [];
  for (const k of ID_KEYS) { const t = text(entry[k]); if (t) out.push(t.replace(/^gid:\/\/shopify\/ProductVariant\//, '')); }
  const urls: string[] = [];
  for (const k of URL_KEYS) { const t = text(entry[k]); if (t) urls.push(t); }
  if (isObj(entry.offers)) for (const k of URL_KEYS) { const t = text(entry.offers[k]); if (t) urls.push(t); }
  for (const u of urls) {
    const q = u.includes('?') ? u.slice(u.indexOf('?') + 1).replace(/#.*$/, '') : '';
    for (const [k, v] of new URLSearchParams(q)) if (k === 'variant' || k === 'id' || k === 'variant_id') out.push(v);
  }
  return out;
}

/** The option pairs an entry carries, name → value, from selectedOptions/options/additionalProperty, option1-3 and its own axis keys. */
function entryPairs(entry: Obj): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const k of ['selectedOptions', 'options', 'additionalProperty']) {
    const v = entry[k];
    const arr = Array.isArray(v) ? v : isObj(v) ? [v] : [];
    for (const o of arr) if (isObj(o)) { const n = text(o.name), val = text(o.value); if (n && val) out.push({ name: n, value: val }); }
  }
  for (const [k, v] of Object.entries(entry)) {
    if (NEVER_READ.test(k)) continue;
    const t = text(v);
    if (t && k.length <= 20) out.push({ name: k, value: t });
  }
  return out;
}

function entryLabels(entry: Obj): { exact: string[]; names: string[] } {
  const exact: string[] = [];
  for (const k of LABEL_KEYS) { const t = text(entry[k]); if (t) exact.push(t); }
  for (const p of entryPairs(entry)) exact.push(p.value);
  const sku = text(entry.sku);
  if (sku) { exact.push(sku); const i = sku.lastIndexOf('-'); if (i >= 0) exact.push(sku.slice(i + 1)); }
  const names: string[] = [];
  for (const k of NAME_KEYS) { const t = text(entry[k]); if (t) names.push(t); }
  return { exact, names };
}

export function matchesPageVariant(entry: unknown, pv: PageVariant): boolean {
  if (!isObj(entry)) return false;
  // Rule 1: id.
  if (pv.ids.length) { const ids = entryIds(entry); if (pv.ids.some((id) => ids.includes(id))) return true; }
  // Rule 2: option pairs — every page pair the entry carries by name must agree; at least one must.
  if (pv.pairs.length) {
    const eps = entryPairs(entry);
    let matched = 0, contradicted = 0;
    for (const p of pv.pairs) {
      const same = eps.filter((e) => normalizeLabel(e.name) === normalizeLabel(p.name));
      if (same.length === 0) continue;
      if (same.some((e) => normalizeLabel(e.value) === normalizeLabel(p.value))) matched++; else contradicted++;
    }
    if (matched > 0 && contradicted === 0) return true;
  }
  // Rule 3: labels. Any one label equal to a size/colour/axis value/sku suffix
  // matches; containment in a name matches only when EVERY page label is
  // contained (Burrow: every entry's name ends "/ Black - Metal", so the Leg
  // Finish label alone would match them all).
  if (pv.labels.length) {
    const { exact, names } = entryLabels(entry);
    const ex = exact.map(normalizeLabel);
    const nm = names.map(normalizeLabel);
    const norms = pv.labels.map(normalizeLabel).filter((n) => n !== '');
    if (norms.some((n) => ex.includes(n))) return true;
    if (nm.length && norms.length && norms.every((n) => n.length >= MIN_CONTAINED && nm.some((name) => name.includes(n)))) return true;
  }
  return false;
}

/** The one entry of `arr` describing the page's variant; undefined for none, several, or no page variant. */
export function pickPageEntry(arr: unknown[], pv: PageVariant | undefined): unknown {
  if (!pv) return undefined;
  const hits = arr.filter((e) => matchesPageVariant(e, pv));
  return hits.length === 1 ? hits[0] : undefined;
}
