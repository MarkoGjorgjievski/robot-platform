// packages/scraper/src/verify/variant-certify.ts
// Certifies a website's variant list across its proof pages (spec 2026-10-01
// §3, "list" method): which list the customer confirmed, and an entry path
// per entry field that reads the confirmed spot value on every page and a
// parseable value on every other entry. Pure: no browser, no network, no
// model. Read certify.ts first — this follows its conventions (CaptureLike,
// normalize/valuesEqual, pathFitsConcept, resolveStructured/getByDotPath,
// objectUrl/displayValue, the fieldHash sha256 style).
import { createHash } from 'node:crypto';
import type { CaptureLike } from './certify.js';
import { getByDotPath } from '../domain-cache.js';
import { normalize, valuesEqual, type NormalizeContext } from './normalize.js';
import { pathFitsConcept, conceptRank } from './field-fit.js';
import { objectUrl, displayValue } from './structured-value.js';
import { entryAxisValue, isVariantEntry } from './variant-detect.js';
import type { CustomerFieldType, VariantListRef, VariantAnswer } from './types.js';

/**
 * An entry field. `axisFrom` names where an axis column reads from on an entry; a list when
 * several detected names map to the same column (the first that yields a value wins). A single
 * string is the same as a one-item list.
 */
export type EntryField = { key: string; name: string; type: CustomerFieldType; concept: string; axisFrom?: string | string[] };
export type EntryPath = { kind: 'path'; path: string } | { kind: 'axis'; from: string | string[] };

/** An axis column's value on an entry: the first of its `from` names that yields one. */
export function entryAxisValueOf(entry: Record<string, unknown>, from: string | string[]): string | undefined {
  for (const name of typeof from === 'string' ? [from] : from) {
    const v = entryAxisValue(entry, name);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** Which of an axis column's `from` names yields a value on this entry, or undefined. */
function axisFromUsed(entry: Record<string, unknown>, from: string | string[]): string | undefined {
  return (typeof from === 'string' ? [from] : from).find((name) => entryAxisValue(entry, name) !== undefined);
}
export type VariantPageResult =
  | { status: 'pass'; count: number }
  | { status: 'none' }
  | { status: 'fail'; message: string }
  | { status: 'not_captured' };
export type VariantVerification = {
  method: 'list' | 'links';
  hash: string;
  passed: boolean;
  list?: VariantListRef;
  entryPaths?: Record<string, EntryPath>;
  fromProduct?: string[];
  collector?: string;                // links method (Task 2)
  pages: Record<string, VariantPageResult>;
  problem?: string;                  // website-level failure
};

/** Website-level failure (list and links methods both use this, spec 2026-10-01 Global Constraints): no proof page has any variants to certify against. */
export const NO_PRODUCT_HAS_VARIANTS = 'None of the products has variants — add one that does, or choose No variants on this website';

type PlainObject = Record<string, unknown>;

function isPlainObject(v: unknown): v is PlainObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** The JSON-LD blocks a page carries: each top-level block plus the objects inside any `@graph`, same scan variant-detect.ts uses. */
function jsonLdBlocks(ldJson: unknown[]): PlainObject[] {
  const out: PlainObject[] = [];
  for (const b of ldJson) {
    if (!isPlainObject(b)) continue;
    out.push(b);
    if (Array.isArray(b['@graph'])) for (const g of b['@graph']) if (isPlainObject(g)) out.push(g);
  }
  return out;
}

function apiBodies(capture: Pick<CaptureLike, 'interceptedRequests'>): unknown[] {
  return capture.interceptedRequests.filter((r) => r.isJson && r.parsedJson !== null && r.parsedJson !== undefined).map((r) => r.parsedJson);
}

/**
 * Resolve a confirmed variant list ref against a fresh capture: the first
 * array found at `ref.path`, in the same containers detection scans, with at
 * least one plain object — only its variant entries kept (`isVariantEntry`,
 * same stub filter `buildList` applies), so certification and `variantList`
 * see the same entries detection counted. `null` when nothing there resolves
 * to such an array (the list moved or the page changed shape), or every
 * entry there is a stub.
 */
export function resolveVariantList(capture: CaptureLike, ref: VariantListRef): Record<string, unknown>[] | null {
  const containers: unknown[] = ref.source === 'json-ld' ? jsonLdBlocks(capture.structuredData.ldJson) : apiBodies(capture);
  for (const c of containers) {
    const v = getByDotPath(c, ref.path);
    if (!Array.isArray(v)) continue;
    const objs = v.filter(isPlainObject).filter(isVariantEntry);
    if (objs.length > 0) return objs;
  }
  return null;
}

const FLATTEN_MAX_ARRAY = 10;

function flattenInto(value: unknown, path: string, depth: number, maxDepth: number, out: Array<{ path: string; raw: unknown }>): void {
  if (depth > maxDepth) return;
  if (Array.isArray(value)) {
    value.slice(0, FLATTEN_MAX_ARRAY).forEach((v, i) => flattenInto(v, `${path}[${i}]`, depth + 1, maxDepth, out));
    return;
  }
  if (value !== null && typeof value === 'object') {
    // An object with a url/contentUrl/@id reads as a leaf in its own right (structured-value.ts
    // objectUrl/displayValue), as well as being walked for scalar leaves inside it.
    if (path !== '' && objectUrl(value) !== null) out.push({ path, raw: value });
    for (const [k, v] of Object.entries(value as PlainObject)) flattenInto(v, path === '' ? k : `${path}.${k}`, depth + 1, maxDepth, out);
    return;
  }
  if (path !== '') out.push({ path, raw: value });
}

/** Every scalar leaf of an entry, and every object reachable through `objectUrl`/`displayValue`, to `maxDepth` (default 4). Dot paths with `[n]` indexes; arrays scanned to their first 10 items. */
export function flattenEntry(entry: Record<string, unknown>, maxDepth = 4): Array<{ path: string; raw: unknown }> {
  const out: Array<{ path: string; raw: unknown }> = [];
  flattenInto(entry, '', 0, maxDepth, out);
  return out;
}

/** Reads an entry field's confirmed path from a resolved entry. */
export function readEntryPath(entry: Record<string, unknown>, p: EntryPath): unknown {
  return p.kind === 'path' ? getByDotPath(entry, p.path) : entryAxisValueOf(entry, p.from);
}

function accepted(value: string): EntryPath {
  return value.startsWith('axis:') ? { kind: 'axis', from: value.slice('axis:'.length) } : { kind: 'path', path: value };
}

/**
 * Per field, the first leaf of the resolved entry that fits: an axis field
 * reads its axis value; otherwise the first leaf whose path fits the
 * field's concept and whose value normalises for its type. `null` when
 * nothing fits — the customer types it. The suggestion's value is the
 * display text, same as the certified entry path would show. `ctx.pageUrl`
 * is the product page's url, so a relative or protocol-relative url/image
 * value reads as the url it is (the same context certification uses).
 */
export function suggestEntryValues(entry: Record<string, unknown>, fields: EntryField[], ctx?: NormalizeContext): Record<string, { value: string; path: string } | null> {
  const leaves = flattenEntry(entry);
  const out: Record<string, { value: string; path: string } | null> = {};
  for (const f of fields) {
    if (f.axisFrom !== undefined) {
      const from = axisFromUsed(entry, f.axisFrom);
      const v = from !== undefined ? entryAxisValue(entry, from) : undefined;
      out[f.key] = from !== undefined && v !== undefined ? { value: v, path: `axis:${from}` } : null;
      continue;
    }
    const fitting = leaves.filter((l) => pathFitsConcept(f.concept, l.path) && normalize(f.type, l.raw, ctx) !== null);
    fitting.sort((a, b) => {
      const ar = conceptRank(f.concept, a.path);
      const br = conceptRank(f.concept, b.path);
      return ar !== br ? ar - br : a.path.length - b.path.length;
    });
    const hit = fitting[0];
    out[f.key] = hit ? { value: displayValue(hit.raw) ?? String(hit.raw), path: hit.path } : null;
  }
  return out;
}

type PageInfo = { url: string; n: number; answer: VariantAnswer; capture: CaptureLike | null };
type FittingPage = PageInfo & { entries: Record<string, unknown>[] };

function candidateKey(c: EntryPath): string {
  return c.kind === 'axis' ? `axis:${typeof c.from === 'string' ? c.from : c.from.join('|')}` : `path:${c.path}`;
}

/**
 * Candidate entry paths for one field, in priority order: the accepted
 * suggestion(s) from each page's spot answer; an axis field's own axis
 * reading as a default; then the flattened leaves of each page's spot entry
 * whose value matches the confirmed one, concept-fitting leaves first, then
 * shorter paths. A boolean field never takes a non-concept-fitting leaf, nor
 * the bare axis default (spec 2026-09-29 C2, mirrored by qualifiesForWeak in
 * certify.ts) — a value match alone cannot tell those apart from any other
 * path; only an accepted candidate is unaffected, since the customer vouched for it.
 */
function candidatesForField(f: EntryField, pages: FittingPage[]): EntryPath[] {
  const out: EntryPath[] = [];
  const seen = new Set<string>();
  const add = (c: EntryPath) => { const k = candidateKey(c); if (!seen.has(k)) { seen.add(k); out.push(c); } };

  for (const p of pages) {
    const path = p.answer.spot?.paths?.[f.key];
    if (path !== undefined) add(accepted(path));
  }
  // Same yes/no restriction as a leaf (spec 2026-09-29 C2): an axis reading cannot be told apart
  // from any other path by value alone, so a boolean field never takes it as a bare default.
  if (f.axisFrom !== undefined && f.type !== 'boolean') add({ kind: 'axis', from: f.axisFrom });

  const leafPaths: string[] = [];
  const leafSeen = new Set<string>();
  for (const p of pages) {
    const spot = p.answer.spot;
    if (!spot) continue;
    const expected = spot.expected[f.key];
    if (expected === undefined) continue;
    const entry = p.entries[spot.index];
    if (!entry) continue;
    for (const leaf of flattenEntry(entry)) {
      if (leafSeen.has(leaf.path)) continue;
      if (!valuesEqual(f.type, leaf.raw, expected, { pageUrl: p.url })) continue;
      if (f.type === 'boolean' && !pathFitsConcept(f.concept, leaf.path)) continue;
      leafSeen.add(leaf.path);
      leafPaths.push(leaf.path);
    }
  }
  leafPaths.sort((a, b) => {
    const af = pathFitsConcept(f.concept, a) ? 0 : 1;
    const bf = pathFitsConcept(f.concept, b) ? 0 : 1;
    if (af !== bf) return af - bf;
    if (af === 0) {
      const ar = conceptRank(f.concept, a);
      const br = conceptRank(f.concept, b);
      if (ar !== br) return ar - br;
    }
    return a.length - b.length;
  });
  for (const path of leafPaths) add({ kind: 'path', path });

  return out;
}

/**
 * Certify a website's variant list and the entry path per field (list
 * method). Follows certify.ts's certification rules (spec 2026-09-29): a
 * path the customer accepted goes first, a yes/no field certifies only on an
 * accepted or concept-fitting path, and values are compared with
 * `valuesEqual`/`normalize`. Failure is always reported with the exact
 * message templates (plan 2026-10-01 Global Constraints), never guessed.
 */
export function certifyVariantList(input: {
  urls: string[]; captures: Record<string, CaptureLike | null>; answers: Record<string, VariantAnswer>;
  fields: EntryField[]; noun: string;
}): Omit<VariantVerification, 'hash' | 'method'> {
  const { urls, captures, answers, fields, noun } = input;
  const pages: PageInfo[] = urls.map((url, i) => ({
    url, n: i + 1, answer: answers[url] ?? { count: 0, labels: [] }, capture: captures[url] ?? null,
  }));

  const withVariants = pages.filter((p) => p.answer.count > 0);
  if (withVariants.length === 0) {
    const out: Record<string, VariantPageResult> = {};
    for (const p of pages) out[p.url] = p.capture ? { status: 'none' } : { status: 'not_captured' };
    return {
      passed: false,
      problem: NO_PRODUCT_HAS_VARIANTS,
      pages: out,
    };
  }

  // Step 2: the list ref. Candidates are the distinct confirmed lists among answers with variants, in page order.
  const candidateLists: VariantListRef[] = [];
  for (const p of withVariants) {
    const list = p.answer.list;
    if (list && !candidateLists.some((c) => c.source === list.source && c.path === list.path)) candidateLists.push(list);
  }

  const captured = pages.filter((p) => p.capture !== null);
  const resolveFor = (ref: VariantListRef, p: PageInfo): Record<string, unknown>[] | null => (p.capture ? resolveVariantList(p.capture, ref) : null);
  const fitsPage = (ref: VariantListRef, p: PageInfo): boolean => {
    const len = resolveFor(ref, p)?.length ?? 0;
    return p.answer.count === 0 ? len === 0 : len === p.answer.count;
  };

  let chosen: VariantListRef | null = candidateLists.find((c) => captured.every((p) => fitsPage(c, p))) ?? null;
  if (!chosen && candidateLists.length > 0) {
    chosen = candidateLists
      .map((c) => ({ c, fit: captured.filter((p) => fitsPage(c, p)).length }))
      .sort((a, b) => b.fit - a.fit)[0]!.c;
  }

  const failures: Record<string, string[]> = {};
  const addFailure = (url: string, message: string) => { (failures[url] ??= []).push(message); };

  if (chosen) {
    for (const p of captured) {
      if (fitsPage(chosen, p)) continue;
      const k = resolveFor(chosen, p)?.length ?? 0;
      if (p.answer.count === 0) addFailure(p.url, `product ${p.n} lists ${k} ${noun} — confirm them`);
      else if (k === 0) addFailure(p.url, `found no ${noun} on product ${p.n}`);
      else if (k < p.answer.count) addFailure(p.url, `found ${k} of ${p.answer.count} ${noun} on product ${p.n}`);
      else addFailure(p.url, `found ${k} ${noun} on product ${p.n}, expected ${p.answer.count}`);
    }
  } else {
    // No answer with variants carried a list ref at all: there is nothing to certify
    // against, so every page's resolved count reads as zero — same as an empty list.
    for (const p of captured) {
      if (p.answer.count > 0) addFailure(p.url, `found no ${noun} on product ${p.n}`);
    }
  }

  const fitting: FittingPage[] = chosen
    ? captured.filter((p) => p.answer.count > 0 && fitsPage(chosen!, p)).map((p) => ({ ...p, entries: resolveFor(chosen!, p) ?? [] }))
    : [];

  // Step 3: duplicates — two entries giving the same tuple of axis values.
  const axisFields = fields.filter((f) => f.axisFrom !== undefined);
  if (axisFields.length > 0) {
    for (const p of fitting) {
      const tuples = p.entries.map((e) => axisFields.map((f) => entryAxisValueOf(e, f.axisFrom!) ?? ''));
      findDup: for (let i = 0; i < tuples.length; i++) {
        for (let j = i + 1; j < tuples.length; j++) {
          // Position-wise, the engine's own notion of "the same" (valuesEqual), not a raw string
          // compare: "Black" and "black " read as one axis value, same as everywhere else here.
          if (tuples[i]!.every((v, k) => valuesEqual('text', v, tuples[j]![k]))) {
            addFailure(p.url, `two ${noun} on product ${p.n} read the same: ${tuples[i]!.join('/')}`);
            break findDup;
          }
        }
      }
    }
  }

  // Step 4: entry fields.
  const fromProduct: string[] = [];
  const entryPaths: Record<string, EntryPath> = {};

  for (const f of fields) {
    const marks = fitting.map((p) => p.answer.spot?.fromProduct?.includes(f.key) ?? false);
    if (marks.length > 0 && marks.every((m) => m)) { fromProduct.push(f.key); continue; }
    if (marks.some((m) => m)) {
      const firstMarkedIdx = fitting.findIndex((p) => p.answer.spot?.fromProduct?.includes(f.key));
      const firstUnmarked = fitting.find((p) => !(p.answer.spot?.fromProduct?.includes(f.key) ?? false))!;
      addFailure(firstUnmarked.url, `${f.name} is taken from the product page on product ${fitting[firstMarkedIdx]!.n} but from the list on product ${firstUnmarked.n}`);
      continue;
    }

    const candidates = candidatesForField(f, fitting);
    const spotEntryOf = (p: FittingPage) => (p.answer.spot ? p.entries[p.answer.spot.index] : undefined);
    const readsA = (c: EntryPath, p: FittingPage): boolean => {
      const spot = p.answer.spot;
      const entry = spot ? spotEntryOf(p) : undefined;
      if (!spot || !entry) return false;
      const expected = spot.expected[f.key];
      if (expected === undefined) return false;
      return valuesEqual(f.type, readEntryPath(entry, c), expected, { pageUrl: p.url });
    };
    const normalizesOthers = (c: EntryPath, p: FittingPage): boolean => {
      const spotIndex = p.answer.spot?.index;
      return p.entries.every((e, idx) => idx === spotIndex || normalize(f.type, readEntryPath(e, c), { pageUrl: p.url }) !== null);
    };

    const winner = candidates.find((c) => fitting.every((p) => readsA(c, p) && normalizesOthers(c, p)));
    if (winner) { entryPaths[f.key] = winner; continue; }

    for (const p of fitting) {
      if (!candidates.some((c) => readsA(c, p))) {
        addFailure(p.url, `${f.name} on the checked variant of product ${p.n} isn't in the list — check the value or mark it from the product page`);
      }
    }
    let best: EntryPath | null = null;
    let bestScore = -1;
    for (const c of candidates) {
      const score = fitting.filter((p) => readsA(c, p) && normalizesOthers(c, p)).length;
      if (score > bestScore) { best = c; bestScore = score; }
    }
    if (best) {
      for (const p of fitting) {
        if (!readsA(best, p) || normalizesOthers(best, p)) continue;
        const m = p.entries.filter((e) => normalize(f.type, readEntryPath(e, best!), { pageUrl: p.url }) === null).length;
        addFailure(p.url, `${f.name} missing on ${m} of ${p.answer.count} ${noun} on product ${p.n}`);
      }
    }
  }

  // Step 5: result.
  const out: Record<string, VariantPageResult> = {};
  for (const p of pages) {
    if (!p.capture) { out[p.url] = { status: 'not_captured' }; continue; }
    const msgs = failures[p.url];
    if (msgs && msgs.length > 0) { out[p.url] = { status: 'fail', message: msgs[0]! }; continue; }
    out[p.url] = p.answer.count > 0 ? { status: 'pass', count: p.answer.count } : { status: 'none' };
  }
  const passed = Object.values(out).every((r) => r.status !== 'fail' && r.status !== 'not_captured');

  return {
    passed,
    ...(chosen ? { list: chosen } : {}),
    entryPaths,
    ...(fromProduct.length ? { fromProduct } : {}),
    pages: out,
  };
}

/** Deep-sorts an object's keys (recursively) so JSON.stringify is independent of insertion order; array order is kept. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === 'object') {
    const obj = v as PlainObject;
    return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, canonical(obj[k])]));
  }
  return v;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** sha256 over the website's variant setup, its proof pages (sorted) and its answers for those pages only, as `fieldHash` does for a field. A proof page with no answer still moves the hash: it is certified as having none. */
export function variantHash(input: {
  method: 'list' | 'links'; axes: Array<{ from: string; axisKey: string }>; urls: string[];
  answers: Record<string, VariantAnswer>; fields: Array<{ key: string; type: string; concept: string }>;
}): string {
  const axes = [...input.axes].sort((a, b) => a.from.localeCompare(b.from));
  const answerKeys = Object.keys(input.answers).filter((u) => input.urls.includes(u)).sort();
  const answers = Object.fromEntries(answerKeys.map((u) => [u, canonical(input.answers[u])]));
  // Only a field's identity goes in — never its name (renaming is free, spec 4.3), whatever else the caller's objects carry.
  const fields = [...input.fields].sort((a, b) => a.key.localeCompare(b.key)).map((f) => ({ key: f.key, type: f.type, concept: f.concept }));
  const urls = [...input.urls].sort();
  return sha256(JSON.stringify({ method: input.method, axes, urls, answers, fields }));
}
