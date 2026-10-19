import type { PageCapture } from '@robot/browser';
import { MAX_CERTIFIED_PATHS } from './constants.js';
import { afterLabel, labelled, normalize, valuesEqual } from './normalize.js';
import { applyTransform } from './transforms.js';
import { resolveStructured, searchStructured } from './search-structured.js';
import { isVolatileXPath, xpathContainsValue, type DomHit, type DomNeedle, type XPathProbeResult } from './dom-scripts.js';
import { isWeakField, normalizeForWeak, pathFitsConcept } from './field-fit.js';
import { displayValue } from './structured-value.js';
import type { CellResult, CertifiedPath, ConfirmedPath, FieldVerification, Mark, SchemaDefinitionField } from './types.js';

export type CandidatePath = CertifiedPath;
export type CaptureLike = Pick<PageCapture, 'url' | 'html' | 'structuredData' | 'interceptedRequests' | 'pageVariant'>;
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
  /** The proof pages the customer said this field is NOT on (spec 2026-10-10 §B2): checked pages where the right answer is nothing. */
  absent?: string[];
  /** The website's default for this field (spec 2026-10-13 §3/§4): every captured page is checked; a blank or default-equal cell is a default cell, where a candidate reading the default or nothing is correct; a candidate must read a value on at least one page to certify; with every page a default cell and nothing certified, the field passes by default only. */
  defaultValue?: string;
};

const SOURCE_RANK: Record<CertifiedPath['source'], number> = { api: 0, 'json-ld': 1, meta: 2, xpath: 3 };

/** A path's length for ranking: a `[page]` step counts as the shortest index `[0]`, so a `[page]` path is never longer than a twin that differs from it only by a numeric index (spec 2026-10-14 §4). Paths without `[page]` keep their own length, so their order is today's. */
const rankLength = (p: string) => p.replace(/\[page\]/g, '[0]').length;
const hasPage = (p: string) => (p.includes('[page]') ? 0 : 1);

export function rankCertified(paths: CertifiedPath[]): CertifiedPath[] {
  // A total order (source, rank length, `[page]` first on a tie), so a `[page]` path ranks above its numeric-index twin whatever else is in the list.
  return [...paths].sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || rankLength(a.path) - rankLength(b.path) || hasPage(a.path) - hasPage(b.path));
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

/** Spec 2026-10-17 §6: the XPaths a mark is read through. An image mark reads its src, a link mark its href; a mark stored before this change gets the suffix here. */
export function markPaths(field: Pick<SchemaDefinitionField, 'type'>, mark: Pick<Mark, 'xpaths'>): string[] {
  const attr = field.type === 'image' ? '/@src' : field.type === 'url' ? '/@href' : '';
  return mark.xpaths.map((xp) => (attr && !/\/@[\w:-]+$/.test(xp) ? xp + attr : xp));
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
      const xps = markPaths(field, mark);
      hitsByUrl[url] = structured.length + xps.length;
      candidates.push(...xps.map((xp) => ({ source: 'xpath' as const, path: xp, transform: 'identity' as const })));
      // A labelled concept's mark may show "Style: 398846_01" for the value 398846_01 (spec 2026-10-17 §6).
      // Only when the marked text has a label: otherwise identity and after_label on one XPath would both certify.
      if (labelled(field.concept) && afterLabel(mark.text) !== null) candidates.push(...xps.map((xp) => ({ source: 'xpath' as const, path: xp, transform: 'after_label' as const })));
      continue;
    }
    const dom = await deps.runDomSearch(capture.html, [{ key: field.key, type: field.type, expected: exp }], capture.url);
    hitsByUrl[url] = structured.length + dom.length;
    candidates.push(...dom.map((h) => ({ source: 'xpath' as const, path: h.xpath, transform: 'identity' as const })));
  }
  return { candidates: dedupe(candidates), hitsByUrl };
}

type Eval = { raw: unknown; correct: boolean; empty: boolean };

/** A field's pages: the proof pages it has an expected value on, plus those the customer said it is absent on (spec 2026-10-10 §B2), in url order. A blank cell (allowed on pages four to six only; binding-input enforces that) means "not checked here". */
export function checkedPages(urls: string[], expected: Record<string, string>, absent: Record<string, true> = {}): string[] {
  return urls.filter((u) => (expected[u] ?? '').trim() !== '' || absent[u] === true);
}

/** A field's expected values with its default filled into every blank, non-absent cell (spec 2026-10-13 §3): what candidate search and certification compare against. Without a default (or a blank one), the map as given. */
export function expectedWithDefault(urls: string[], expected: Record<string, string>, defaultValue: string | undefined, absent: Record<string, true> = {}): Record<string, string> {
  const def = defaultValue?.trim();
  if (!def) return expected;
  return Object.fromEntries(urls.filter((u) => !absent[u]).map((u) => [u, (expected[u] ?? '').trim() === '' ? def : expected[u]!]));
}

/**
 * Greedy set cover over SAFE candidates: repeatedly take the candidate correct
 * on the most still-uncovered pages, ties going to today's rank. Returns []
 * unless every page is covered within MAX_CERTIFIED_PATHS. Order does not
 * affect correctness (a safe path is correct or empty on every checked page,
 * so whichever resolves first is right); it is by pages proven, then rank,
 * so the common layout is tried first at scale.
 *
 * Only the pages with an expected value take part. On a page the customer said
 * the field is absent on (spec 2026-10-10 §B2), every safe path is "correct"
 * because it is empty there, so that page proves nothing about a path: counting
 * it would hand every one-page path a second page and let a pile of them certify.
 * The absent pages still take part in safety (a value there makes a path unsafe,
 * so it never reaches this cover), and any path chosen here is empty on them.
 *
 * On a default cell (spec 2026-10-13 §4) an empty read is correct but proves
 * nothing, so `isProven` (correct with a value) counts the pages a path carries.
 * With a default (`defaultCells` given) a path also scores and covers only the
 * pages it is proven on, else a one-page path "covers" every default cell by
 * reading nothing there and crowds out the common layout; and a default cell
 * left uncovered is fine (the default fills it at extraction) — only an
 * uncovered typed, non-default page fails the cover.
 */
function greedyCover(safe: CandidatePath[], pages: string[], absent: Set<string>, isCorrect: (c: CandidatePath, url: string) => boolean, isProven: (c: CandidatePath, url: string) => boolean, rank: (paths: CandidatePath[]) => CandidatePath[], defaultCells?: Set<string>): CandidatePath[] {
  const valued = pages.filter((u) => !absent.has(u));
  if (valued.length === 0) return [];
  const ranked = rank(safe);
  const uncovered = new Set(valued);
  const chosen: CandidatePath[] = [];
  const covers = defaultCells ? isProven : isCorrect;
  while (uncovered.size > 0 && chosen.length < MAX_CERTIFIED_PATHS) {
    let best: CandidatePath | null = null;
    let bestGain = 0;
    for (const c of ranked) {
      if (chosen.includes(c)) continue;
      const gain = [...uncovered].filter((u) => covers(c, u)).length;
      if (gain > bestGain) { best = c; bestGain = gain; }
    }
    if (!best) break;
    chosen.push(best);
    for (const u of [...uncovered]) if (covers(best, u)) uncovered.delete(u);
  }
  if ([...uncovered].some((u) => !defaultCells?.has(u))) return [];
  const proven = (c: CandidatePath) => valued.filter((u) => isProven(c, u)).length;
  // A cover is a common layout plus exceptions, never a pile of one-page paths. Ikea, 2026-09-17:
  // three XPaths anchored on data-product-name="KIVIK" / "GLOSTAD" / "HEMLINGBY" were each correct on
  // their own proof page and empty on the others, so each was safe and together they covered every
  // page; at scale none matches any other product. One path must carry at least two pages, both
  // with a value (an absent page never counts here).
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
  const absentSet = new Set(input.absent ?? []);
  const absentMap: Record<string, true> = Object.fromEntries([...absentSet].map((u) => [u, true as const]));
  // Only the pages this field is checked on take part: evaluation, cells, completeness.
  // An absent page is checked too (spec 2026-10-10 §B2), but has no expected value.
  const defaultValue = input.defaultValue?.trim() || undefined;
  const allUrls = Object.keys(captures);
  // With a default every captured page is checked (spec 2026-10-13 §3); otherwise only the pages with a value or an absent mark.
  const urls = defaultValue !== undefined ? allUrls : checkedPages(allUrls, input.expected, absentMap);
  const filled = expectedWithDefault(allUrls, input.expected, defaultValue, absentMap);
  const expected = Object.fromEntries(urls.filter((u) => !absentSet.has(u)).map((u) => [u, filled[u] ?? input.expected[u] ?? '']));
  // A default cell: blank or equal to the default (spec 2026-10-13 §4). A candidate reading the default or nothing is correct there.
  const defaultCells = new Set(defaultValue === undefined ? [] : urls.filter((u) => !absentSet.has(u) && valuesEqual(field.type, expected[u]!, defaultValue)));
  const filtered = dedupe(input.candidates).filter((c) => c.source !== 'xpath' || !Object.values(expected).some((e) => xpathContainsValue(c.path, e)));
  // A confirmed path is always a candidate (spec 2026-09-29 C1), though still only a candidate:
  // it must be correct or empty on every checked page like any other. Dedupe on the FULL path
  // id (source + path + transform), not source+path alone: the cache can hold the same
  // source+path under a different transform (e.g. `cents_to_units`), which must not crowd out
  // the confirmed path's own identity reading — that reading may be the correct one.
  const confirmedExtra = (input.confirmed ?? [])
    .filter((p, i, all) => all.findIndex((q) => q.source === p.source && q.path === p.path) === i)
    .map((p): CandidatePath => ({ source: p.source, path: p.path, transform: 'identity' }))
    .filter((p) => !filtered.some((c) => pathId(c) === pathId(p)));
  const withConfirmed = [...filtered, ...confirmedExtra];
  const weak = isWeakField(field.type, Object.values(expected));
  const opts = { confirmed: input.confirmed, markXPaths: input.markXPaths };
  const candidates = weak ? withConfirmed.filter((c) => qualifiesForWeak(field, c, opts)) : withConfirmed;
  const capturedUrls = urls.filter((u) => captures[u] !== null);
  const rank = (paths: CandidatePath[]) => rankConfirmedFirst(paths, input.confirmed);

  // Same normalisation isWeakField uses (case-insensitive for text), so the flag and the
  // weak-field filter above can never disagree about what counts as "the same value". Also
  // its `!norms.has(null)` guard: expected values that all fail to normalise are not "the
  // same value", they are all unparseable — never flag that as weak evidence.
  const norms = new Set(Object.values(expected).map((e) => normalizeForWeak(field.type, e)));
  const weakEvidence = norms.size === 1 && !norms.has(null) && Object.keys(expected).length > 1;
  const complete = capturedUrls.length === urls.length;
  // Every captured page a default cell (spec 2026-10-13 §4): the field may pass by default only.
  const allDefault = defaultValue !== undefined && complete && capturedUrls.length > 0 && capturedUrls.every((u) => defaultCells.has(u));
  const defaultOnlyResult = (): FieldVerification => ({
    key: field.key,
    cells: Object.fromEntries(urls.map((u): [string, CellResult] => [u, captures[u] ? { status: 'pass', found: '' } : { status: 'not_captured' }])),
    certified: [], weakEvidence, aiCalled: false, incomplete: false, defaultOnly: true,
  });
  if (weak && candidates.length === 0) {
    // Default only takes precedence over no_fitting_path (spec 2026-10-13 §4).
    if (allDefault) return defaultOnlyResult();
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
    const ctx = { pageUrl: capture.url, pageVariant: capture.pageVariant };
    const xpaths = candidates.filter((c) => c.source === 'xpath').map((c) => c.path);
    const probe = xpaths.length ? await deps.evalXPaths(capture.html, xpaths) : {};
    for (const c of candidates) {
      const rawBase = c.source === 'xpath' ? probe[c.path] ?? null : resolveStructured(capture, c.source, c.path, ctx);
      const raw = applyTransform(rawBase, c.transform);
      const empty = raw === null || raw === undefined || raw === '';
      // An absent page: a candidate is correct iff it resolves to nothing; a value there
      // makes `e.correct || e.empty` false, so it is unsafe and never certifies (spec 2026-10-10 §B2).
      const matches = !empty && valuesEqual(field.type, raw, expected[url] ?? '', ctx);
      // An absent page: correct iff nothing. A default cell: nothing or the default (spec 2026-10-13 §4). Otherwise the typed value.
      const correct = absentSet.has(url) ? empty : defaultCells.has(url) ? (empty || matches) : matches;
      if (!evals.has(pathId(c))) evals.set(pathId(c), {});
      evals.get(pathId(c))![url] = { raw, correct, empty };
    }
  }
  const isCorrect = (c: CandidatePath, u: string) => evals.get(pathId(c))?.[u]?.correct === true;
  const isProven = (c: CandidatePath, u: string) => { const e = evals.get(pathId(c))?.[u]; return !!e && e.correct && !e.empty; };
  // Spec 2026-10-13 §4: with a default a candidate must read something somewhere — a path empty on every page proves nothing. Without one, nothing changes.
  const readsSomething = (c: CandidatePath) => defaultValue === undefined || capturedUrls.some((u) => isProven(c, u));

  // Safe: on every captured page the field is checked on, correct or nothing.
  // A path that resolves to a WRONG value anywhere is never certified: at
  // scale paths are tried in order and the first value wins.
  const safe = candidates.filter((c) => readsSomething(c) && capturedUrls.length > 0 && capturedUrls.every((u) => { const e = evals.get(pathId(c))?.[u]; return !!e && (e.correct || e.empty); }));
  const correctOnAllCaptured = safe.filter((c) => capturedUrls.every((u) => isCorrect(c, u)));
  // With a default an empty read is correct on a default cell, so a path that reads a value on
  // one page only is "correct on every page" without proving a layout: it may not certify as one
  // layout (alone or riding along); it goes to the cover, which wants one path proven on two pages.
  const provenCount = (c: CandidatePath) => capturedUrls.filter((u) => !absentSet.has(u) && isProven(c, u)).length;
  const oneLayoutPool = defaultValue === undefined ? correctOnAllCaptured : correctOnAllCaptured.filter((c) => provenCount(c) >= 2);
  const oneLayout = complete ? rank(oneLayoutPool).slice(0, MAX_CERTIFIED_PATHS) : [];
  // One layout: exactly today's result, no provenOn. Otherwise a cover, each path stamped with its pages.
  const cover = complete && oneLayout.length === 0 ? greedyCover(safe, capturedUrls, absentSet, isCorrect, isProven, rank, defaultValue === undefined ? undefined : defaultCells) : [];
  // provenOn (and so thinEvidence) counts the pages with a value only: an absent page proves nothing about a path.
  const certified: CertifiedPath[] = oneLayout.length > 0
    ? oneLayout
    : cover.map((c) => ({ ...c, provenOn: capturedUrls.filter((u) => !absentSet.has(u) && isProven(c, u)) }));
  if (certified.length === 0 && allDefault) return defaultOnlyResult();
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
  // On an absent page `raw` is empty by definition of `correct` above, so the found text
  // for a passing absent cell is '' rather than the string "null"/"undefined".
  const foundText = (raw: unknown) => (raw === null || raw === undefined || raw === '' ? '' : displayValue(raw) ?? String(raw));

  const cells: Record<string, CellResult> = {};
  for (const url of urls) {
    const capture = captures[url];
    if (!capture) { cells[url] = { status: 'not_captured' }; continue; }
    const ctx = { pageUrl: capture.url };
    if (certified.length > 0) {
      // Every checked page is covered; safety makes the first non-empty path the right one.
      const winner = certified.find((p) => isCorrect(p, url))!;
      const raw = evals.get(pathId(winner))![url]!.raw;
      cells[url] = { status: 'pass', found: foundText(raw), path: winner };
      continue;
    }
    if (!complete && rankedCorrectOnAllCaptured.length > 0) {
      const top = rankedCorrectOnAllCaptured[0]!;
      const raw = evals.get(pathId(top))![url]!.raw;
      cells[url] = { status: 'pass', found: foundText(raw), path: top };
      continue;
    }
    if (absentSet.has(url)) {
      // Red only when a path that is right everywhere else produces a value here, the same idea
      // as twoOfThree below. A value from a path already wrong on another page (a DOM-search hit
      // from one page, an api field that is wrong elsewhere too) says nothing against the
      // customer's mark, so it must not invite them to doubt it (Decathlon, 2026-10-10).
      const valuedOthers = capturedUrls.filter((u) => u !== url && !absentSet.has(u));
      const blamed = valuedOthers.length === 0 ? undefined : candidates.find((c) => {
        const here = evals.get(pathId(c))?.[url]?.raw;
        return !(here === null || here === undefined || here === '') && valuedOthers.every((u) => isCorrect(c, u));
      });
      const produced = blamed ? evals.get(pathId(blamed))![url]!.raw : undefined;
      if (produced !== undefined) {
        // A path right on every other page produced a value on a page the customer said has none.
        cells[url] = { status: 'fail', reason: 'found_unexpected', ...(displayValue(produced) !== null ? { found: displayValue(produced)! } : {}) };
      } else {
        // No path that is right elsewhere produced a value here: this page reads as the customer
        // said, whatever kept the OTHER pages from certifying (spec 2026-10-10 §B2).
        const p = rankedSafe.find((c) => isCorrect(c, url)) ?? rankedCorrectOnAllCaptured[0];
        cells[url] = { status: 'pass', found: '', ...(p ? { path: p } : {}) };
      }
      continue;
    }
    const others = capturedUrls.filter((u) => u !== url);
    const nearMisses = [...new Set(candidates.map((c) => evals.get(pathId(c))?.[url]?.raw).map(displayValue).filter((r): r is string => r !== null && r !== '' && !valuesEqual(field.type, r, expected[url] ?? '', ctx)))].slice(0, 3);
    const twoOfThree = candidates.find((c) => others.length > 0 && others.every((u) => evals.get(pathId(c))?.[u]?.correct) && !evals.get(pathId(c))?.[url]?.correct);
    if (twoOfThree) {
      const here = evals.get(pathId(twoOfThree))![url]!.raw;
      const empty = here === null || here === undefined || here === '';
      // A structured object with no url/contentUrl/@id (spec 2026-09-29 C4) has nothing to
      // show: `found` is optional on a fail cell, so it is left out rather than stringified.
      const hereDisplay = displayValue(here);
      const foundField = hereDisplay !== null ? { found: hereDisplay } : {};
      if (empty) cells[url] = { status: 'fail', reason: 'not_found', ...(nearMisses.length ? { nearMisses } : {}) };
      else if (normalize(field.type, here, ctx) === null) cells[url] = { status: 'fail', reason: 'type_mismatch', ...foundField, ...(nearMisses.length ? { nearMisses } : {}) };
      else cells[url] = { status: 'fail', reason: 'different_value', ...foundField, ...(nearMisses.length ? { nearMisses } : {}) };
      continue;
    }
    const safeHere = rankedSafe.find((c) => isCorrect(c, url));
    // Spec 2026-10-17 §5: on any number of proof pages, a page a safe path is right on reads as found;
    // the page nothing covers carries the diagnosis. (Spec 2026-09-17 §9 property 4 limited this to more than three pages.)
    if (complete && safeHere) {
      const raw = evals.get(pathId(safeHere))![url]!.raw;
      cells[url] = { status: 'pass', found: foundText(raw), path: safeHere };
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
