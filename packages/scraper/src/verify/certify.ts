import type { PageCapture } from '@robot/browser';
import { MAX_CERTIFIED_PATHS, VERIFY_URL_MIN } from './constants.js';
import { normalize, valuesEqual } from './normalize.js';
import { applyTransform } from './transforms.js';
import { resolveStructured, searchStructured } from './search-structured.js';
import { isVolatileXPath, xpathContainsValue, type DomHit, type DomNeedle, type XPathProbeResult } from './dom-scripts.js';
import { isWeakField, pathFitsConcept } from './field-fit.js';
import type { CellResult, CertifiedPath, ConfirmedPath, FieldVerification, Mark, SchemaDefinitionField } from './types.js';

export type CandidatePath = CertifiedPath;
export type CaptureLike = Pick<PageCapture, 'url' | 'html' | 'structuredData' | 'interceptedRequests'>;
export type CertifyDeps = { evalXPaths: (html: string, xpaths: string[]) => Promise<XPathProbeResult> };
export type CertifyInput = {
  field: SchemaDefinitionField;
  expected: Record<string, string>;
  captures: Record<string, CaptureLike | null>;
  candidates: CandidatePath[];
  /** Structured paths the customer accepted answers from (spec 2026-09-29 C1): always candidates, and certified first. */
  confirmed?: ConfirmedPath[];
  /** The XPaths of the elements the customer marked for this field: the only DOM paths a weak field may certify. */
  markXPaths?: string[];
};

const SOURCE_RANK: Record<CertifiedPath['source'], number> = { api: 0, 'json-ld': 1, meta: 2, xpath: 3 };

export function rankCertified(paths: CertifiedPath[]): CertifiedPath[] {
  return [...paths].sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || a.path.length - b.path.length);
}

/** Was this candidate confirmed by the customer? Source and path; the transform does not matter. */
function isConfirmedPath(c: CandidatePath, confirmed: ConfirmedPath[] | undefined): boolean {
  return c.source !== 'xpath' && (confirmed ?? []).some((p) => p.source === c.source && p.path === c.path);
}

/**
 * May this candidate certify a weak field (spec 2026-09-29 C2)? A value match
 * cannot tell a yes/no field's paths apart (anything that is 1 or true on every
 * proof page matches), nor a field whose proof pages share one value. So only a
 * path the customer confirmed, the XPath of an element they marked, or a
 * structured path whose name fits the field's concept may stand for it. An
 * unmarked DOM hit never qualifies, whatever its XPath ends in.
 */
export function qualifiesForWeak(field: SchemaDefinitionField, c: CandidatePath, opts: { confirmed?: ConfirmedPath[]; markXPaths?: string[] }): boolean {
  if (isConfirmedPath(c, opts.confirmed)) return true;
  if (c.source === 'xpath') return (opts.markXPaths ?? []).includes(c.path);
  return pathFitsConcept(field.concept, c.path);
}

/** Confirmed paths first (in rank order), then the rest (in rank order): API stays first among the paths the customer did not confirm (spec 2026-09-29 §7.1). */
function rankConfirmedFirst(paths: CandidatePath[], confirmed: ConfirmedPath[] | undefined): CandidatePath[] {
  const ranked = rankCertified(paths);
  return [...ranked.filter((p) => isConfirmedPath(p, confirmed)), ...ranked.filter((p) => !isConfirmedPath(p, confirmed))];
}

function pathId(p: CandidatePath): string {
  return `${p.source} ${p.path} ${p.transform}`;
}

function dedupe(candidates: CandidatePath[]): CandidatePath[] {
  const seen = new Set<string>();
  return candidates.filter((c) => { const id = pathId(c); if (seen.has(id)) return false; seen.add(id); return true; });
}

export async function gatherCandidates(
  field: SchemaDefinitionField,
  expected: Record<string, string>,
  captures: Record<string, CaptureLike | null>,
  deps: { runDomSearch: (html: string, needles: DomNeedle[], pageUrl: string) => Promise<DomHit[]>; marks?: Record<string, Mark> },
): Promise<{ candidates: CandidatePath[]; hitsByUrl: Record<string, number> }> {
  const candidates: CandidatePath[] = [];
  const hitsByUrl: Record<string, number> = {};
  for (const [url, capture] of Object.entries(captures)) {
    if (!capture) continue;
    const exp = expected[url] ?? '';
    if (exp.trim() === '') continue; // not checked here: nothing to search for
    const structured = searchStructured(capture, field.type, exp);
    candidates.push(...structured.map((s) => ({ source: s.source, path: s.path, transform: s.transform })));
    const mark = deps.marks?.[url];
    if (mark) {
      // The customer said which element it is: the mark's XPaths stand in for the DOM search's hits on
      // this page, which is what settles `ambiguous` (spec 2026-09-18 §3.5). The mark still has to be
      // correct or empty on every other checked page, like any candidate.
      hitsByUrl[url] = structured.length + mark.xpaths.length;
      candidates.push(...mark.xpaths.map((xp) => ({ source: 'xpath' as const, path: xp, transform: 'identity' as const })));
      continue;
    }
    const dom = await deps.runDomSearch(capture.html, [{ key: field.key, type: field.type, expected: exp }], capture.url);
    hitsByUrl[url] = structured.length + dom.length;
    candidates.push(...dom.map((h) => ({ source: 'xpath' as const, path: h.xpath, transform: 'identity' as const })));
  }
  return { candidates: dedupe(candidates), hitsByUrl };
}

type Eval = { raw: unknown; correct: boolean; empty: boolean };

/** A field's pages: the proof pages it has an expected value on, in url order. A blank cell (allowed on pages four to six only; binding-input enforces that) means "not checked here". */
export function checkedPages(urls: string[], expected: Record<string, string>): string[] {
  return urls.filter((u) => (expected[u] ?? '').trim() !== '');
}

/**
 * Greedy set cover over SAFE candidates: repeatedly take the candidate correct
 * on the most still-uncovered pages, ties going to today's rank. Returns []
 * unless every page is covered within MAX_CERTIFIED_PATHS. Order does not
 * affect correctness (a safe path is correct or empty on every checked page,
 * so whichever resolves first is right); it is by pages proven, then rank,
 * so the common layout is tried first at scale.
 */
function greedyCover(safe: CandidatePath[], pages: string[], isCorrect: (c: CandidatePath, url: string) => boolean, rank: (paths: CandidatePath[]) => CandidatePath[]): CandidatePath[] {
  const ranked = rank(safe);
  const uncovered = new Set(pages);
  const chosen: CandidatePath[] = [];
  while (uncovered.size > 0 && chosen.length < MAX_CERTIFIED_PATHS) {
    let best: CandidatePath | null = null;
    let bestGain = 0;
    for (const c of ranked) {
      if (chosen.includes(c)) continue;
      const gain = [...uncovered].filter((u) => isCorrect(c, u)).length;
      if (gain > bestGain) { best = c; bestGain = gain; }
    }
    if (!best) break;
    chosen.push(best);
    for (const u of [...uncovered]) if (isCorrect(best, u)) uncovered.delete(u);
  }
  if (uncovered.size > 0) return [];
  const proven = (c: CandidatePath) => pages.filter((u) => isCorrect(c, u)).length;
  // A cover is a common layout plus exceptions, never a pile of one-page paths. Ikea, 2026-09-17:
  // three XPaths anchored on data-product-name="KIVIK" / "GLOSTAD" / "HEMLINGBY" were each correct on
  // their own proof page and empty on the others, so each was safe and together they covered every
  // page; at scale none matches any other product. One path must carry at least two pages.
  if (Math.max(...chosen.map(proven)) < 2) return [];
  return [...chosen].sort((a, b) => proven(b) - proven(a) || ranked.indexOf(a) - ranked.indexOf(b));
}

/** Is this an XPath anchored on a value that will change on the site's next deploy (dom-scripts.ts `looksVolatile`)? */
export function isVolatilePath(p: CandidatePath): boolean {
  return p.source === 'xpath' && isVolatileXPath(p.path);
}

/**
 * Certify a field, preferring paths that will survive the site's next deploy.
 *
 * An XPath anchored on a build hash or a version stamp certifies today and
 * goes empty later with no warning (Ikea, 2026-09-17: a whole column rested on
 * `data-skapa="price-module@11.1.8"`). The generator no longer produces such
 * XPaths, but stored and AI-proposed ones still arrive as candidates. So:
 * certify from the stable candidates alone; fall back to the full set only
 * when that does not certify, because a fragile column still beats an empty one.
 */
export async function certify(input: CertifyInput, deps: CertifyDeps): Promise<FieldVerification> {
  const stable = input.candidates.filter((c) => !isVolatilePath(c));
  if (stable.length === input.candidates.length) return certifyCandidates(input, deps);
  const fromStable = await certifyCandidates({ ...input, candidates: stable }, deps);
  return fromStable.certified.length > 0 ? fromStable : certifyCandidates(input, deps);
}

async function certifyCandidates(input: CertifyInput, deps: CertifyDeps): Promise<FieldVerification> {
  const { field, captures } = input;
  // Only the pages this field is checked on take part: evaluation, cells, completeness.
  const urls = checkedPages(Object.keys(captures), input.expected);
  const expected = Object.fromEntries(urls.map((u) => [u, input.expected[u]!]));
  const filtered = dedupe(input.candidates).filter((c) => c.source !== 'xpath' || !Object.values(expected).some((e) => xpathContainsValue(c.path, e)));
  // A confirmed path is always a candidate (spec 2026-09-29 C1), though still only a candidate:
  // it must be correct or empty on every checked page like any other.
  const confirmedExtra = (input.confirmed ?? [])
    .filter((p, i, all) => all.findIndex((q) => q.source === p.source && q.path === p.path) === i)
    .filter((p) => !filtered.some((c) => c.source === p.source && c.path === p.path))
    .map((p): CandidatePath => ({ source: p.source, path: p.path, transform: 'identity' }));
  const withConfirmed = [...filtered, ...confirmedExtra];
  const weak = isWeakField(field.type, Object.values(expected));
  const opts = { confirmed: input.confirmed, markXPaths: input.markXPaths };
  const candidates = weak ? withConfirmed.filter((c) => qualifiesForWeak(field, c, opts)) : withConfirmed;
  const capturedUrls = urls.filter((u) => captures[u] !== null);
  const rank = (paths: CandidatePath[]) => rankConfirmedFirst(paths, input.confirmed);

  const norms = new Set(Object.values(expected).map((e) => normalize(field.type, e)));
  const weakEvidence = norms.size === 1 && Object.keys(expected).length > 1;
  if (weak && candidates.length === 0) {
    // Nothing on these pages can be told to be this field: say so, rather than
    // certify whatever happens to hold the same value everywhere.
    const cells: Record<string, CellResult> = Object.fromEntries(urls.map((u): [string, CellResult] =>
      [u, captures[u] ? { status: 'fail', reason: 'no_fitting_path' } : { status: 'not_captured' }]));
    return { key: field.key, cells, certified: [], weakEvidence, aiCalled: false, incomplete: capturedUrls.length !== urls.length };
  }

  // Evaluate every candidate on every captured, checked page.
  const evals = new Map<string, Record<string, Eval>>(); // pathId → url → eval
  for (const url of capturedUrls) {
    const capture = captures[url]!;
    const ctx = { pageUrl: capture.url };
    const xpaths = candidates.filter((c) => c.source === 'xpath').map((c) => c.path);
    const probe = xpaths.length ? await deps.evalXPaths(capture.html, xpaths) : {};
    for (const c of candidates) {
      const rawBase = c.source === 'xpath' ? probe[c.path] ?? null : resolveStructured(capture, c.source, c.path);
      const raw = applyTransform(rawBase, c.transform);
      const empty = raw === null || raw === undefined || raw === '';
      const correct = !empty && valuesEqual(field.type, raw, expected[url] ?? '', ctx);
      if (!evals.has(pathId(c))) evals.set(pathId(c), {});
      evals.get(pathId(c))![url] = { raw, correct, empty };
    }
  }
  const isCorrect = (c: CandidatePath, u: string) => evals.get(pathId(c))?.[u]?.correct === true;

  const complete = capturedUrls.length === urls.length;
  // Safe: on every captured page the field is checked on, correct or nothing.
  // A path that resolves to a WRONG value anywhere is never certified: at
  // scale paths are tried in order and the first value wins.
  const safe = candidates.filter((c) => capturedUrls.length > 0 && capturedUrls.every((u) => { const e = evals.get(pathId(c))?.[u]; return !!e && (e.correct || e.empty); }));
  const correctOnAllCaptured = safe.filter((c) => capturedUrls.every((u) => isCorrect(c, u)));
  const oneLayout = complete ? rank(correctOnAllCaptured).slice(0, MAX_CERTIFIED_PATHS) : [];
  // One layout: exactly today's result, no provenOn. Otherwise a cover, each path stamped with its pages.
  const cover = complete && oneLayout.length === 0 ? greedyCover(safe, capturedUrls, isCorrect, rank) : [];
  const certified: CertifiedPath[] = oneLayout.length > 0
    ? oneLayout
    : cover.map((c) => ({ ...c, provenOn: capturedUrls.filter((u) => isCorrect(c, u)) }));
  const thinEvidence = cover.length > 0 && certified.some((p) => p.provenOn?.length === 1);
  const rankedCorrectOnAllCaptured = rankCertified(correctOnAllCaptured);
  // Without a certification, a page a safe path is correct on still reads as
  // pass, so the customer sees what works and which page is the problem.
  // This yields to the twoOfThree analysis above: when a path correct on
  // every OTHER page disagrees here, that disagreement is the diagnosis and
  // must win — which is why this safeHere block sits after the twoOfThree
  // block (spec property 3: the page where the majority path is wrong must
  // fail loud with `different_value`, not read as a quiet pass from some
  // other safe-but-unproven path).
  const rankedSafe = rankCertified(safe);

  const cells: Record<string, CellResult> = {};
  for (const url of urls) {
    const capture = captures[url];
    if (!capture) { cells[url] = { status: 'not_captured' }; continue; }
    const ctx = { pageUrl: capture.url };
    if (certified.length > 0) {
      // Every checked page is covered; safety makes the first non-empty path the right one.
      const winner = certified.find((p) => isCorrect(p, url))!;
      cells[url] = { status: 'pass', found: String(evals.get(pathId(winner))![url]!.raw), path: winner };
      continue;
    }
    if (!complete && rankedCorrectOnAllCaptured.length > 0) {
      const top = rankedCorrectOnAllCaptured[0]!;
      const raw = evals.get(pathId(top))![url]!.raw;
      cells[url] = { status: 'pass', found: String(raw), path: top };
      continue;
    }
    const others = capturedUrls.filter((u) => u !== url);
    const nearMisses = [...new Set(candidates.map((c) => evals.get(pathId(c))?.[url]?.raw).filter((r) => r !== null && r !== undefined && r !== '').map(String))].slice(0, 3);
    const twoOfThree = candidates.find((c) => others.length > 0 && others.every((u) => evals.get(pathId(c))?.[u]?.correct) && !evals.get(pathId(c))?.[url]?.correct);
    if (twoOfThree) {
      const here = evals.get(pathId(twoOfThree))![url]!.raw;
      const empty = here === null || here === undefined || here === '';
      if (empty) cells[url] = { status: 'fail', reason: 'not_found', ...(nearMisses.length ? { nearMisses } : {}) };
      else if (normalize(field.type, here, ctx) === null) cells[url] = { status: 'fail', reason: 'type_mismatch', found: String(here), ...(nearMisses.length ? { nearMisses } : {}) };
      else cells[url] = { status: 'fail', reason: 'different_value', found: String(here), ...(nearMisses.length ? { nearMisses } : {}) };
      continue;
    }
    const safeHere = rankedSafe.find((c) => isCorrect(c, url));
    if (complete && urls.length > VERIFY_URL_MIN && safeHere) {
      cells[url] = { status: 'pass', found: String(evals.get(pathId(safeHere))![url]!.raw), path: safeHere };
      continue;
    }
    const correctHere = candidates.some((c) => evals.get(pathId(c))?.[url]?.correct);
    cells[url] = correctHere
      ? { status: 'fail', reason: 'ambiguous', ...(nearMisses.length ? { nearMisses } : {}) }
      : { status: 'fail', reason: 'not_found', ...(nearMisses.length ? { nearMisses } : {}) };
  }

  return {
    key: field.key, cells, certified,
    weakEvidence,
    aiCalled: false, incomplete: !complete,
    ...(thinEvidence ? { thinEvidence: true } : {}),
  };
}
