/**
 * The Verification tab's Variants row (spec 2026-10-01 §3-4): what each proof
 * page's cell shows before and after confirmation, the one-tick confirm, the
 * variant-level entry fields' spot-check rows, and what the Verify bar needs
 * to know about variants. Pure — no UI, no tRPC.
 *
 * `VariantAnswer`/`VariantResultView` mirror the server's shapes
 * (`VariantAnswer` in `@robot/scraper`'s `verify/types.ts`, the `pages` of
 * `VariantVerification` in `verify/variant-certify.ts`) rather than importing
 * them: the app never imports scraper code. `tsc` on the route that passes
 * server data in is what keeps the two in step, as `variants-view.ts` already
 * does for detection.
 */
import { pluralOf, type DetectResult, type VariantSetup } from './variants-view';

export type VariantAnswer = {
  count: number;
  labels: string[];
  list?: { source: string; path: string };
  links?: string[];
  spot?: { index: number; url?: string; expected: Record<string, string>; paths?: Record<string, string>; fromProduct?: string[] };
};

export type VariantResultView = {
  passed: boolean;
  problem?: string;
  pages: Record<string, { status: 'pass'; count: number } | { status: 'none' } | { status: 'fail'; message: string } | { status: 'not_captured' }>;
};

export type VariantCell =
  | { kind: 'waiting'; text: string }                       // "Waiting for the screenshot"
  | { kind: 'found'; text: string; labels: string[] }       // orange — found, not confirmed: "4 colours"
  | { kind: 'none-found'; text: string }                    // grey — nothing found, nothing to do: "No variants"
  | { kind: 'confirmed'; text: string; labels: string[] }   // green
  | { kind: 'confirmed-none'; text: string }                // green — "No variants on this product"
  | { kind: 'failed'; text: string };                       // red — the page's message, after Verify

/**
 * Whether an answer fits the website's method (final review I3): a product
 * with variants answered for the list method carries the list it was
 * confirmed against, and one answered for the links method carries its
 * links. An answer given under the other method does not, and counts as
 * unanswered here — its cell shows what the capture finds again, and the
 * Verify bar asks for every product to be confirmed. "No variants on this
 * product" (count 0) fits either method.
 */
export function answerFitsMethod(method: 'list' | 'links', answer: VariantAnswer): boolean {
  if (answer.count <= 0) return true;
  return method === 'list' ? !!answer.list : !!answer.links && answer.links.length > 0;
}

/** The answers that fit the method (`answerFitsMethod`); the rest are left out, as if never given. */
export function fittingAnswers(method: 'list' | 'links', answers: Record<string, VariantAnswer>): Record<string, VariantAnswer> {
  return Object.fromEntries(Object.entries(answers).filter(([, a]) => answerFitsMethod(method, a)));
}

/**
 * List "Not right?" (final review M4): the answer that re-confirms the same
 * list as it reads now, when its count has changed since it was confirmed —
 * null when there is nothing to re-confirm (no list, or the count is
 * unchanged). The checked variant is dropped with the old count, the same
 * way `confirmAnswer` drops it when the list changes.
 */
export function reuseListAnswer(answer: VariantAnswer | undefined, listed: { count: number; labels: string[] } | null | undefined): VariantAnswer | null {
  if (!answer?.list || !listed || listed.count === answer.count) return null;
  return { count: listed.count, labels: listed.labels, list: answer.list };
}

/** The plural word for this website's variants (Global Constraints): one mapped column's name, lower-cased, in its exact plural (`pluralOf`: "capacities", "finishes"); "variants" with two or more mapped columns, or none. Same rule as the API's `variantNoun` (`packages/api/src/verify/variant-fields.ts`). Feed it `columnNames`, not one name per detected axis — several detected names can map to the same column. */
export function variantNoun(axisNames: string[]): string {
  return axisNames.length === 1 ? pluralOf(axisNames[0]!.toLowerCase()) : 'variants';
}

/**
 * Each column a website's variant setup maps, once (Global Constraints):
 * several detected axis names mapped to the same column (`color` and
 * `colour`, both "Colour") count as the one column, not one entry per
 * mapping — in the order each column is first mapped. A mapping whose
 * column no longer exists on the schema (a stale setup) names nothing.
 * Feeds `variantNoun`.
 */
export function columnNames(setup: VariantSetup | null, axes: Array<{ key: string; name: string }>): string[] {
  if (!setup) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of setup.axes) {
    if (seen.has(a.axisKey)) continue;
    seen.add(a.axisKey);
    const name = axes.find((x) => x.key === a.axisKey)?.name;
    if (name) out.push(name);
  }
  return out;
}

/** One entry's label: its axis values joined "/" ("Black/10C"), else its sku, else a 1-based placeholder. */
function entryLabel(axes: string[], entry: Record<string, string>, index: number): string {
  const values = axes.map((a) => entry[a]).filter((v): v is string => !!v);
  if (values.length > 0) return values.join('/');
  return entry.sku ?? `Variant ${index + 1}`;
}

/** What a page's capture shows, before any confirmation: the first list's or first link group's count and labels, or null when the method found nothing on this page. */
function detectedOn(method: 'list' | 'links', page: DetectResult['pages'][number]): { count: number; labels: string[] } | null {
  if (method === 'list') {
    const list = page.lists[0];
    if (!list) return null;
    return { count: list.count, labels: list.entries.map((e, i) => entryLabel(list.axes, e, i)) };
  }
  const group = page.links[0];
  if (!group || group.links.length === 0) return null;
  return { count: group.count, labels: group.links.map((l) => l.label) };
}

/**
 * Per-url cell state (Rules): a current result's fail beats everything; else
 * an answer that fits the method (`answerFitsMethod`) is `confirmed`/`confirmed-none`; else what the capture shows,
 * `found`/`none-found`, or `waiting` with no capture yet. A stale
 * (non-current) result's fail is ignored — the answer, or the capture, shows
 * through instead.
 */
export function variantCells(args: {
  method: 'list' | 'links'; urls: string[]; detection: DetectResult | null; answers: Record<string, VariantAnswer>;
  result: VariantResultView | null; resultCurrent: boolean; noun: string;
}): Record<string, VariantCell> {
  const { method, urls, detection, answers, result, resultCurrent, noun } = args;
  const out: Record<string, VariantCell> = {};

  for (const url of urls) {
    if (result && resultCurrent) {
      const r = result.pages[url];
      if (r && r.status === 'fail') {
        out[url] = { kind: 'failed', text: r.message };
        continue;
      }
    }

    const answer = answers[url];
    if (answer && answerFitsMethod(method, answer)) {
      out[url] =
        answer.count > 0
          ? { kind: 'confirmed', text: `${answer.count} ${noun}`, labels: answer.labels }
          : { kind: 'confirmed-none', text: 'No variants on this product' };
      continue;
    }

    const page = detection?.pages.find((p) => p.url === url) ?? null;
    if (!page || !page.captured) {
      out[url] = { kind: 'waiting', text: 'Waiting for the screenshot' };
      continue;
    }
    const found = detectedOn(method, page);
    out[url] =
      found && found.count > 0
        ? { kind: 'found', text: `${found.count} ${noun}`, labels: found.labels }
        : { kind: 'none-found', text: 'No variants' };
  }

  return out;
}

function sameLinks(a: string[] | undefined, b: string[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Whether two hrefs are "the same page" for the purposes of picking a
 * variant link that isn't the page itself: host + pathname (one trailing
 * slash ignored) + query, case-insensitive on the host, fragment ignored —
 * `?color=red` is kept because a query string can be a variant's own
 * identity on some sites. Unparseable URLs fall back to a raw compare.
 */
function samePage(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    const norm = (u: URL) => `${u.hostname.toLowerCase()}${u.pathname.replace(/\/$/, '')}${u.search}`;
    return norm(ua) === norm(ub);
  } catch {
    return a === b;
  }
}

/**
 * The one-tick confirm (Rules): what pressing "Check this one" / the
 * confirm action writes for a page, from what its capture shows right now.
 * Keeps an existing `spot` — the customer's checked entry/variant page —
 * when the count and the list/links it was checked against are unchanged,
 * so re-detecting (a fresh capture) never silently drops a confirmed check.
 *
 * A links answer must always carry `spot.url` when the page has a link that
 * is not the page itself (the server now fails a product without one): the
 * first such link, or the first link at all when every one of them is the
 * page itself.
 */
export function confirmAnswer(method: 'list' | 'links', page: DetectResult['pages'][number], current: VariantAnswer | undefined): VariantAnswer {
  if (method === 'list') {
    const list = page.lists[0];
    if (!list) return { count: 0, labels: [] };
    const labels = list.entries.map((e, i) => entryLabel(list.axes, e, i));
    const result: VariantAnswer = { count: list.count, labels, list: { source: list.source, path: list.path } };
    const unchanged = !!current?.spot && current.count === list.count && current.list?.source === list.source && current.list?.path === list.path;
    if (unchanged) result.spot = current!.spot;
    return result;
  }

  const group = page.links[0];
  if (!group || group.links.length === 0) return { count: 0, labels: [] };
  const labels = group.links.map((l) => l.label);
  const links = group.links.map((l) => l.href);
  const unchanged = !!current?.spot && current.count === group.count && sameLinks(current.links, links);
  if (unchanged) return { count: group.count, labels, links, spot: current!.spot };

  const notSelf = group.links.find((l) => !samePage(l.href, page.url));
  const url = (notSelf ?? group.links[0]!).href;
  return { count: group.count, labels, links, spot: { index: 0, url, expected: {} } };
}

type Spot = NonNullable<VariantAnswer['spot']>;

/**
 * The answer as it may be saved (final review I1): a column (`columnKeys`)
 * can never be "From the product page" (Global Constraints), so it is taken
 * out of `spot.fromProduct` — an answer stored under the old rules would
 * otherwise be refused on every save of that product. An emptied
 * `fromProduct` is dropped. Applied to every save that keeps a spot.
 */
export function stripColumnsFromProduct(answer: VariantAnswer, columnKeys: string[]): VariantAnswer {
  const spot = answer.spot;
  if (!spot?.fromProduct) return answer;
  const kept = spot.fromProduct.filter((k) => !columnKeys.includes(k));
  if (kept.length === spot.fromProduct.length) return answer;
  const { fromProduct: _dropped, ...rest } = spot;
  return { ...answer, spot: kept.length > 0 ? { ...rest, fromProduct: kept } : rest };
}

/** Whether an entry field is marked "From the product page" on a spot. */
function fromProduct(spot: Spot | undefined, key: string): boolean {
  return !!spot?.fromProduct?.includes(key);
}

/** The entry field's confirmed value on a spot, or undefined when it has none (blank counts as none). */
function confirmedValue(spot: Spot | undefined, key: string): string | undefined {
  const v = spot?.expected[key];
  return v !== undefined && v.trim() !== '' ? v : undefined;
}

/**
 * Whether an entry field counts as checked on a confirmed variant (Rules,
 * `variantsNeed`): confirmed, or taken from the product page — the same two
 * states `spotRows` renders as settled rows. A column (`isColumn`) can never
 * be checked via from-product (Global Constraints: it differs per variant by
 * definition) — a stale answer still holding it there (a website verified
 * under the old rules) counts as not checked, the same way `spotRows` reads
 * that row as `needs-you` rather than settled.
 */
function entryFieldChecked(spot: Spot | undefined, key: string, isColumn: boolean): boolean {
  if (isColumn) return confirmedValue(spot, key) !== undefined;
  return fromProduct(spot, key) || confirmedValue(spot, key) !== undefined;
}

export type SpotRow = { key: string; name: string; state: 'suggested' | 'confirmed' | 'from-product' | 'needs-you'; value?: string; suggestion?: { value: string; path: string } };

/**
 * An entry field's row in the spot-check panel (Rules): from-product, then
 * confirmed, then suggested, else needs-you. A column (`columnKeys`, the axis
 * entry fields) can never read `from-product` — it differs per variant by
 * definition (Global Constraints) — so its row is never that state even when
 * a stale answer still holds the key in `fromProduct` (a website verified
 * under the old rules): that reads as `needs-you`, asking the customer to fix
 * it, the same way an unanswered row does.
 */
export function spotRows(args: {
  fields: Array<{ key: string; name: string }>;
  columnKeys: string[];
  suggestions: Record<string, { value: string; path: string } | null> | null;
  answer: VariantAnswer | undefined;
}): SpotRow[] {
  const { fields, columnKeys, suggestions, answer } = args;
  const columns = new Set(columnKeys);
  return fields.map(({ key, name }) => {
    if (fromProduct(answer?.spot, key)) {
      if (columns.has(key)) return { key, name, state: 'needs-you' as const };
      return { key, name, state: 'from-product' as const };
    }
    const confirmed = confirmedValue(answer?.spot, key);
    if (confirmed !== undefined) return { key, name, state: 'confirmed' as const, value: confirmed };
    const suggestion = suggestions?.[key];
    if (suggestion) return { key, name, state: 'suggested' as const, suggestion };
    return { key, name, state: 'needs-you' as const };
  });
}

export type VariantsNeed = { kind: 'none' } | { kind: 'blocked'; reason: string } | { kind: 'pending' } | { kind: 'done' };

/**
 * What the Verify bar needs to know about variants (Rules, in order):
 * nothing required, setup missing, an unanswered product (an answer that
 * does not fit the method counts as unanswered), a list-method
 * product whose confirmed variant has an unchecked entry field, not current,
 * then current (`done`). `done` says nothing about whether the last check
 * passed — the route reads `passed` off the loaded status for that, the
 * same way `extractEnabled` does.
 */
/** `variantsNeed`'s reason for a list with no entry field, word for word certification's `problem` (`variant-certify.ts`). */
export const NOTHING_READ_NO_FIELDS = 'Nothing is read from the variants — add a field that differs per variant';

export function variantsNeed(args: {
  variants: { required: 'setup-missing' | 'yes'; current: boolean; passed: boolean } | null;
  urls: string[]; answers: Record<string, VariantAnswer>; method: 'list' | 'links' | null;
  entryFieldKeys: string[];
  /** `entryFieldKeys`' columns (axis entry fields) — these can never read checked via from-product (see `entryFieldChecked`). */
  columnKeys: string[];
}): VariantsNeed {
  const { variants, urls, answers, method, entryFieldKeys, columnKeys } = args;
  if (!variants) return { kind: 'none' };
  if (variants.required === 'setup-missing') return { kind: 'blocked', reason: "Set up this website's variants below" };
  if (urls.some((u) => { const a = answers[u]; return !a || (method !== null && !answerFitsMethod(method, a)); })) {
    return { kind: 'blocked', reason: 'Confirm the variants of every product' };
  }

  if (method === 'list') {
    // A certified list reads something (final review I2 ruling): with no entry field at all
    // there is nothing to read from the list — the same sentence certification gives.
    if (entryFieldKeys.length === 0) return { kind: 'blocked', reason: NOTHING_READ_NO_FIELDS };
    const columns = new Set(columnKeys);
    for (let i = 0; i < urls.length; i++) {
      const a = answers[urls[i]!];
      if (!a || a.count <= 0) continue;
      if (entryFieldKeys.some((key) => !entryFieldChecked(a.spot, key, columns.has(key)))) return { kind: 'blocked', reason: `Check one variant of product ${i + 1}` };
    }
  }

  return variants.current ? { kind: 'done' } : { kind: 'pending' };
}

/**
 * Extract's gate (Rules): fields current and all passed, and variants are
 * either not required (`null`, `ignore` mode or method `none`) or current
 * and passed. `status` mirrors `sources.verificationStatus`'s own field
 * names, so the route can pass that query's result straight through.
 */
export function extractEnabled(status: { current: boolean; allPassed: boolean; variants: { current: boolean; passed: boolean } | null }): boolean {
  if (!status.current || !status.allPassed) return false;
  return status.variants === null || (status.variants.current && status.variants.passed);
}
