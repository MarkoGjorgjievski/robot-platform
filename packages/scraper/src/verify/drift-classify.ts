// packages/scraper/src/verify/drift-classify.ts
// Decides what happened to one drifted field on fresh proof-page captures:
// other-layout (certified paths still read every expected value), moved
// (a mechanically found path certifies against the stored expected values),
// changed (an old certified path, or a concept-fitting structured path,
// reads a valid different value), or lost. Free and pure-ish: page loads and
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
  | { status: 'ok'; value: string | null; mark?: Mark }
  | { status: 'page-gone' };

export type DriftFieldResult = {
  key: string;
  result: 'other-layout' | 'moved' | 'changed' | 'lost';
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
    const rawBase = p.source === 'xpath' ? probe[p.path] ?? null : resolveStructured(capture, p.source, p.path);
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
  const { candidates } = await gatherCandidates(field, expected, captures, { runDomSearch: deps.runDomSearch });
  const verification = await certify({ field, expected, captures, candidates, confirmed, markXPaths }, deps);
  if (verification.certified.length === 0) return null;
  if (!decidingUrls.every((u) => verification.cells[u]?.status === 'pass')) return null;
  const pages: Record<string, DriftPage> = {};
  for (const url of decidingUrls) {
    const capture = captures[url]!;
    const cell = verification.cells[url];
    if (!cell || cell.status !== 'pass') return null; // defensive; already checked above
    pages[url] = { status: 'ok', value: cell.found, mark: markFor(cell.path, capture) };
  }
  return { key: field.key, result: 'moved', path: verification.certified[0], pages };
}

/**
 * Changed: among the old certified paths, plus the concept-fitting structured
 * paths found by `searchStructuredByConcept` on the captured pages (any value
 * of the field's type — this never filters on value, since a path holding a
 * NEW value is exactly what "changed" is looking for), the first path that
 * reads a valid value on every deciding page and the expected value on none
 * of the pages where it differs.
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
    for (const url of decidingUrls) {
      const capture = captures[url]!;
      const raw = valsByUrl.get(url)!.get(id);
      pages[url] = { status: 'ok', value: displayValue(raw) ?? String(raw), mark: markFor(candidate, capture) };
    }
    return { key: field.key, result: 'changed', path: candidate, pages };
  }
  return null;
}

export async function classifyDrift(input: ClassifyDriftInput, deps: DriftDeps): Promise<DriftFieldResult> {
  const { field, expected, certified, captures, confirmed, markXPaths } = input;
  const allUrls = Object.keys(captures);
  const goneUrls = allUrls.filter((u) => captures[u] === null);
  const decidingUrls = allUrls.filter((u) => captures[u] !== null && (expected[u] ?? '').trim() !== '');

  if (decidingUrls.length === 0) {
    return { key: field.key, result: 'lost', pages: goneEntries(goneUrls) };
  }

  const otherLayout = await tryOtherLayout(field, expected, certified, captures, decidingUrls, deps);
  if (otherLayout) return { ...otherLayout, pages: { ...otherLayout.pages, ...goneEntries(goneUrls) } };

  const moved = await tryMoved(field, expected, captures, decidingUrls, confirmed, markXPaths, deps);
  if (moved) return { ...moved, pages: { ...moved.pages, ...goneEntries(goneUrls) } };

  const changed = await tryChanged(field, expected, certified, captures, decidingUrls, deps);
  if (changed) return { ...changed, pages: { ...changed.pages, ...goneEntries(goneUrls) } };

  const lostPages: Record<string, DriftPage> = Object.fromEntries(decidingUrls.map((u) => [u, { status: 'ok', value: null } as const]));
  return { key: field.key, result: 'lost', pages: { ...lostPages, ...goneEntries(goneUrls) } };
}
