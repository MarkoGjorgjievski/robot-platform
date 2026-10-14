// packages/scraper/src/verify/drift-classify.ts
// Decides what happened to one drifted field on fresh proof-page captures:
// other-layout (certified paths still read every expected value), moved
// (a mechanically found path certifies against the stored expected values),
// changed (an old certified path, or a concept-fitting structured path,
// reads a valid different value), or lost — or not-checked, when no page could
// be read now and at least one was walled off. Free and pure-ish: page loads and
// code only, no model call, ever (plan 2026-10-05-drift-repair Global
// Constraints). Read certify.ts first — this follows its conventions.
import { certify, gatherCandidates, type CaptureLike, type CertifyDeps } from './certify.js';
import { resolveStructured, searchStructuredByConcept } from './search-structured.js';
import { normalize, valuesEqual, type NormalizeContext } from './normalize.js';
import { applyTransform } from './transforms.js';
import { displayValue } from './structured-value.js';
import type { Box } from './box-map.js';
import type { DomHit, DomNeedle } from './dom-scripts.js';
import type { CertifiedPath, ConfirmedPath, Mark, SchemaDefinitionField } from './types.js';

export type DriftPage =
  /**
   * Set on a `changed` result only: `changed` says whether this page's value
   * differs from the stored expected one (type-aware, `valuesEqual`), so the
   * app lists and accepts only those pages; `was` is that stored expected
   * value as the check read it — the "(was {old})" half of the row, which must
   * not follow the board once the customer accepts the new value.
   */
  | { status: 'ok'; value: string | null; mark?: Mark; changed?: boolean; was?: string }
  | { status: 'page-gone' }
  /**
   * The page exists but could not be read now: the site refused or challenged
   * the browser, answered blank, timed out, or the host is backing off after a
   * wall. `reason` is the verdict sentence. Such a page neither decides nor is
   * gone (known-gaps fixes 2026-10-11, Task 2).
   */
  | { status: 'not-checked'; reason: string };

export type DriftFieldResult = {
  key: string;
  /** `not-checked`: no page could be read now and at least one was not checked — nothing was learned. */
  result: 'other-layout' | 'moved' | 'changed' | 'lost' | 'not-checked';
  path?: CertifiedPath;
  pages: Record<string, DriftPage>;
  /** filled by the API from the run, not by classifyDrift */
  emptyShare?: number;
};

export type DriftCheckResults = { runId: string | null; fields: Record<string, DriftFieldResult> };

export type DriftCapture = CaptureLike & { boxes?: Box[] };
export type DriftDeps = CertifyDeps & { runDomSearch: (html: string, needles: DomNeedle[], pageUrl: string) => Promise<DomHit[]> };

export type ClassifyDriftInput = {
  field: SchemaDefinitionField;
  expected: Record<string, string>;
  certified: CertifiedPath[];
  captures: Record<string, DriftCapture | null>;
  confirmed?: ConfirmedPath[];
  markXPaths?: string[];
  /** Pages that could not be read now, by url → the verdict sentence. Neither deciding nor gone; stamped `not-checked`. */
  notChecked?: Record<string, string>;
};

/** The box (from the page's box map) whose xpaths include this one, as a Mark — the same shape the customer's own click produces. Undefined when no box carries it (no boxes supplied, or the path is not among them). */
export function markFromXPath(boxes: Box[], xpath: string): Mark | undefined {
  const box = boxes.find((b) => b.xpaths.includes(xpath));
  return box ? { xpaths: box.xpaths, text: box.text, rect: box.rect } : undefined;
}

const URL_SHAPED = /^https?:\/\//i;

function pathId(p: { source: string; path: string; transform: string }): string {
  return `${p.source} ${p.path} ${p.transform}`;
}

/** Every candidate's raw (transformed) reading on one capture, batching the XPath probe into a single call, as certify.ts does. */
async function evalManyOnCapture(paths: CertifiedPath[], capture: DriftCapture, deps: DriftDeps): Promise<Map<string, unknown>> {
  const xpaths = [...new Set(paths.filter((p) => p.source === 'xpath').map((p) => p.path))];
  const probe = xpaths.length ? await deps.evalXPaths(capture.html, xpaths) : {};
  const out = new Map<string, unknown>();
  for (const p of paths) {
    const rawBase = p.source === 'xpath' ? probe[p.path] ?? null : resolveStructured(capture, p.source, p.path, { pageVariant: capture.pageVariant });
    out.set(pathId(p), applyTransform(rawBase, p.transform));
  }
  return out;
}

/** A mark for this path's reading, when it can be built: only an XPath path names an element to box. */
function markFor(p: CertifiedPath, capture: DriftCapture): Mark | undefined {
  return p.source === 'xpath' ? markFromXPath(capture.boxes ?? [], p.path) : undefined;
}

function goneEntries(goneUrls: string[]): Record<string, DriftPage> {
  return Object.fromEntries(goneUrls.map((u) => [u, { status: 'page-gone' as const }]));
}

/**
 * Still works: the same certified path set reads `valuesEqual(type, expected)`
 * on every deciding page. Evaluated the way `certify` checks a candidate —
 * structured through `resolveStructured`, XPath through `deps.evalXPaths`.
 */
async function tryOtherLayout(
  field: SchemaDefinitionField, expected: Record<string, string>, certified: CertifiedPath[],
  captures: Record<string, DriftCapture | null>, decidingUrls: string[], deps: DriftDeps,
): Promise<DriftFieldResult | null> {
  if (certified.length === 0) return null;
  const pages: Record<string, DriftPage> = {};
  for (const url of decidingUrls) {
    const capture = captures[url]!;
    const vals = await evalManyOnCapture(certified, capture, deps);
    const ctx: NormalizeContext = { pageUrl: capture.url };
    const match = certified.find((p) => {
      const raw = vals.get(pathId(p));
      return raw !== null && raw !== undefined && raw !== '' && valuesEqual(field.type, raw, expected[url] ?? '', ctx);
    });
    if (!match) return null;
    const raw = vals.get(pathId(match));
    pages[url] = { status: 'ok', value: displayValue(raw) ?? String(raw) };
  }
  return { key: field.key, result: 'other-layout', pages };
}

/**
 * Moved: a mechanically found path (certification's own candidate search)
 * certifies against the stored expected values on every deciding page. Weak
 * fields follow certify's own rule (qualifiesForWeak) via `confirmed`/
 * `markXPaths` — never the AI fallback, no agent is passed or constructed.
 */
async function tryMoved(
  field: SchemaDefinitionField, expected: Record<string, string>, captures: Record<string, DriftCapture | null>,
  decidingUrls: string[], confirmed: ConfirmedPath[] | undefined, markXPaths: string[] | undefined, deps: DriftDeps,
): Promise<DriftFieldResult | null> {
  // Only the deciding pages take part: a page-gone page (null capture) would
  // make certify's page set incomplete and refuse every path, so a field that
  // really moved would read as lost (final review I1). certify's own rules
  // still hold on the subset — two deciding pages still need a path carrying both.
  // A move is a proposal the customer may accept as a new mark: one page alone
  // can't tell the field's element from any other element showing the same
  // value, so "moved" needs at least two working pages (as certification does).
  if (decidingUrls.length < 2) return null;
  const decidingCaptures = Object.fromEntries(decidingUrls.map((u) => [u, captures[u]!]));
  const decidingExpected = Object.fromEntries(decidingUrls.map((u) => [u, expected[u]!]));
  const { candidates } = await gatherCandidates(field, decidingExpected, decidingCaptures, { runDomSearch: deps.runDomSearch });
  // No `absent` here: `decidingExpected` is built from pages with a value, and the drift
  // check only ever decides on those (spec 2026-10-10 §B2 does not reach drift repair).
  const verification = await certify({ field, expected: decidingExpected, captures: decidingCaptures, candidates, confirmed, markXPaths }, deps);
  if (verification.certified.length === 0) return null;
  if (!decidingUrls.every((u) => verification.cells[u]?.status === 'pass')) return null;
  const pages: Record<string, DriftPage> = {};
  for (const url of decidingUrls) {
    const capture = captures[url]!;
    const cell = verification.cells[url];
    if (!cell || cell.status !== 'pass') return null; // defensive; already checked above
    // `path` is only absent on an absent-page pass with zero candidates (spec 2026-10-10 §B2),
    // which `tryMoved` never produces: it passes no `absent`, so a pass cell always names one.
    pages[url] = { status: 'ok', value: cell.found, mark: cell.path ? markFor(cell.path, capture) : undefined };
  }
  return { key: field.key, result: 'moved', path: verification.certified[0], pages };
}

/**
 * Changed: among the old certified paths, plus the concept-fitting structured
 * paths found by `searchStructuredByConcept` on the captured pages (any value
 * of the field's type — this never filters on value, since a path holding a
 * NEW value is exactly what "changed" is looking for), the first path that
 * reads a valid value on every deciding page and a value different from the
 * expected one on at least one of them (final review M1: a path reading every
 * expected value is not "changed"). Each page is marked `changed` by
 * `valuesEqual`, so the app lists and accepts only the pages that differ (I3).
 *
 * A text field the customer did not verify as URLs (no deciding page's
 * expected value is URL-shaped) never takes a URL-shaped value from the
 * concept search: schema.org's `offers.availability` ("https://schema.org/
 * InStock") fits an availability concept, but "Page now shows
 * https://schema.org/InStock (was In stock)" is not what happened to a stock
 * line. The old certified paths are not filtered — they are the field's own.
 */
async function tryChanged(
  field: SchemaDefinitionField, expected: Record<string, string>, certified: CertifiedPath[],
  captures: Record<string, DriftCapture | null>, decidingUrls: string[], deps: DriftDeps,
): Promise<DriftFieldResult | null> {
  const pool: CertifiedPath[] = [...certified];
  const seen = new Set(pool.map(pathId));
  const fromConceptSearch = new Set<string>();
  const rejectUrls = field.type === 'text' && !decidingUrls.some((u) => URL_SHAPED.test((expected[u] ?? '').trim()));
  for (const url of decidingUrls) {
    const capture = captures[url]!;
    const found = searchStructuredByConcept(capture, field.type, field.concept);
    for (const s of found) {
      const candidate: CertifiedPath = { source: s.source, path: s.path, transform: s.transform };
      const id = pathId(candidate);
      if (seen.has(id)) continue;
      seen.add(id);
      fromConceptSearch.add(id);
      pool.push(candidate);
    }
  }
  if (pool.length === 0) return null;

  const valsByUrl = new Map<string, Map<string, unknown>>();
  for (const url of decidingUrls) valsByUrl.set(url, await evalManyOnCapture(pool, captures[url]!, deps));

  for (const candidate of pool) {
    const id = pathId(candidate);
    let validEverywhere = true;
    for (const url of decidingUrls) {
      const capture = captures[url]!;
      const raw = valsByUrl.get(url)!.get(id);
      const value = normalize(field.type, raw, { pageUrl: capture.url });
      if (value === null) { validEverywhere = false; break; }
      if (rejectUrls && fromConceptSearch.has(id) && URL_SHAPED.test(String(value).trim())) { validEverywhere = false; break; }
    }
    if (!validEverywhere) continue;
    const pages: Record<string, DriftPage> = {};
    let differsSomewhere = false;
    for (const url of decidingUrls) {
      const capture = captures[url]!;
      const raw = valsByUrl.get(url)!.get(id);
      const changed = !valuesEqual(field.type, raw, expected[url] ?? '', { pageUrl: capture.url });
      if (changed) differsSomewhere = true;
      pages[url] = { status: 'ok', value: displayValue(raw) ?? String(raw), mark: markFor(candidate, capture), changed, was: expected[url] ?? '' };
    }
    if (!differsSomewhere) continue;
    return { key: field.key, result: 'changed', path: candidate, pages };
  }
  return null;
}

export async function classifyDrift(input: ClassifyDriftInput, deps: DriftDeps): Promise<DriftFieldResult> {
  const { field, expected, certified, captures, confirmed, markXPaths } = input;
  const notChecked = input.notChecked ?? {};
  const allUrls = Object.keys(captures).filter((u) => !(u in notChecked));
  const goneUrls = allUrls.filter((u) => captures[u] === null);
  const decidingUrls = allUrls.filter((u) => captures[u] != null && (expected[u] ?? '').trim() !== '');
  // Pages that could not be read now, and pages gone: merged into whatever the deciding pages say.
  const unread: Record<string, DriftPage> = {
    ...Object.fromEntries(Object.entries(notChecked).map(([u, reason]) => [u, { status: 'not-checked' as const, reason }])),
    ...goneEntries(goneUrls),
  };

  if (decidingUrls.length === 0) {
    // Nothing was read: with a page we could not check, nothing was learned either — not "lost".
    const result = Object.keys(notChecked).length > 0 ? 'not-checked' : 'lost';
    return { key: field.key, result, pages: unread };
  }

  const otherLayout = await tryOtherLayout(field, expected, certified, captures, decidingUrls, deps);
  if (otherLayout) return { ...otherLayout, pages: { ...otherLayout.pages, ...unread } };

  const moved = await tryMoved(field, expected, captures, decidingUrls, confirmed, markXPaths, deps);
  if (moved) return { ...moved, pages: { ...moved.pages, ...unread } };

  const changed = await tryChanged(field, expected, certified, captures, decidingUrls, deps);
  if (changed) return { ...changed, pages: { ...changed.pages, ...unread } };

  const lostPages: Record<string, DriftPage> = Object.fromEntries(decidingUrls.map((u) => [u, { status: 'ok', value: null } as const]));
  return { key: field.key, result: 'lost', pages: { ...lostPages, ...unread } };
}
