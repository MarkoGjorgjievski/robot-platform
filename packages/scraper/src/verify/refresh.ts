// packages/scraper/src/verify/refresh.ts
// Websites change (spec 2026-10-21 §3.2): may a check refresh a field's
// expected values by itself? Only for a field that changes by nature (price,
// rating, review count, availability), only where the same certified path that
// passed on a page now reads a different, valid, in-range value the page
// shows, never through a fixed variant index, and only when every page with an
// expected value reads one. All or nothing per field. Pure: readings in, a
// plan out. No model, ever.
import { normalize, valuesEqual } from './normalize.js';
import { readsFixedVariant } from './page-variant-match.js';
import type { CertifiedPath, CustomerFieldType, SchemaDefinitionField } from './types.js';

/** The concepts whose value changes by nature, and the types each may carry (spec §3.2's table). */
export const CHANGES_BY_NATURE: Readonly<Record<string, readonly CustomerFieldType[]>> = {
  price: ['money'],
  rating: ['number'],
  review_count: ['number'],
  availability: ['boolean', 'text'],
};

/** How far a number may move in one refresh, either way: a cents/units change or another element is not a price change. */
export const REFRESH_MAX_FACTOR = 5;

export function changesByNature(field: Pick<SchemaDefinitionField, 'concept' | 'type'>): boolean {
  return CHANGES_BY_NATURE[field.concept]?.includes(field.type) ?? false;
}

/** What a run writes on one page from a field's certified paths: the value (null for a miss), the path that read it, and whether the page shows it. */
export type PathReading = { value: string | null; path: CertifiedPath | null; shown: boolean | null };
export type RefreshRefusal = 'not-by-nature' | 'too-few-pages' | 'empty' | 'not-same-place' | 'fixed-variant' | 'not-shown' | 'out-of-range';
export type RefreshPage = { was: string; now: string; path: CertifiedPath };
export type RefreshPlan =
  | { kind: 'none' }
  | { kind: 'refused'; reason: RefreshRefusal; url?: string }
  | { kind: 'refresh'; pages: Record<string, RefreshPage> };

const pathId = (p: CertifiedPath) => `${p.source} ${p.path} ${p.transform}`;

/** Spec §3.2 condition 7. `now` is a run's value, `was` the stored expected value. Text and booleans are always in range. */
export function inRefreshRange(field: Pick<SchemaDefinitionField, 'type' | 'concept'>, now: string, was: string): boolean {
  if (field.type !== 'money' && field.type !== 'number') return true;
  const nNorm = normalize(field.type, now);
  const oNorm = normalize(field.type, was);
  if (nNorm === null || oNorm === null) return false;
  const n = Number(nNorm);
  const o = Number(oNorm);
  if (!Number.isFinite(n) || !Number.isFinite(o)) return false;
  if (field.concept === 'review_count') {
    if (!Number.isInteger(n) || n < 0) return false;
    if (o === 0) return true;   // a first review
    if (n === 0) return false;  // reviews do not vanish: another element
  } else {
    if (n <= 0 || o <= 0) return false;
    if (field.concept === 'rating') {
      const scale = o <= 5 ? 5 : o <= 10 ? 10 : 100;
      if (n > scale) return false;
    }
  }
  return n / o <= REFRESH_MAX_FACTOR && o / n <= REFRESH_MAX_FACTOR;
}

/** The expected value a refresh writes: stock in the customer's words, money in its two-decimal form, anything else as a run writes it. */
export function refreshedText(field: Pick<SchemaDefinitionField, 'type' | 'concept'>, value: string): string {
  if (field.type === 'boolean') {
    const yes = normalize('boolean', value) === 'true';
    if (field.concept === 'availability') return yes ? 'In stock' : 'Out of stock';
    return yes ? 'Yes' : 'No';
  }
  if (field.type === 'money') return normalize('money', value) ?? value;
  return value;
}

/**
 * The refresh a check may apply for one field (spec §3.2). `readings` holds only the pages captured now;
 * `provenOn` is the field's certifying result's passing cell path per page.
 */
export function planRefresh(input: {
  field: Pick<SchemaDefinitionField, 'type' | 'concept'>;
  expected: Record<string, string>;
  provenOn: Record<string, CertifiedPath | undefined>;
  readings: Record<string, PathReading>;
}): RefreshPlan {
  const { field, expected, provenOn, readings } = input;
  const deciding = Object.keys(readings).filter((u) => (expected[u] ?? '').trim() !== '');
  const differing = deciding.filter((u) => {
    const v = readings[u]!.value;
    return v !== null && !valuesEqual(field.type, v, expected[u]!, { pageUrl: u });
  });
  if (differing.length === 0) return { kind: 'none' };
  if (!changesByNature(field)) return { kind: 'refused', reason: 'not-by-nature' };
  const empty = deciding.find((u) => readings[u]!.value === null);
  if (empty !== undefined) return { kind: 'refused', reason: 'empty', url: empty };
  if (deciding.length < 2) return { kind: 'refused', reason: 'too-few-pages' };
  const pages: Record<string, RefreshPage> = {};
  for (const url of differing) {
    const r = readings[url]!;
    const proven = provenOn[url];
    if (!r.path || !proven || pathId(r.path) !== pathId(proven)) return { kind: 'refused', reason: 'not-same-place', url };
    if (readsFixedVariant(r.path)) return { kind: 'refused', reason: 'fixed-variant', url };
    if (r.shown === false) return { kind: 'refused', reason: 'not-shown', url };
    if (!inRefreshRange(field, r.value!, expected[url]!)) return { kind: 'refused', reason: 'out-of-range', url };
    pages[url] = { was: expected[url]!, now: refreshedText(field, r.value!), path: r.path };
  }
  return { kind: 'refresh', pages };
}
