import { createHash } from 'node:crypto';
import { BROWSER_UNAVAILABLE, CaptureError, type IBrowser, type PageCapture, type ReadyCheck } from '@robot/browser';
import { isCapReached, type ProposePathsAgent } from '@robot/agent';
import { certify, checkedPages, expectedWithDefault, gatherCandidates, isVolatilePath, markPaths, readsOneSource, type CandidatePath, type CaptureLike } from './certify.js';
import { buildVerificationReadyCheck } from './verification-ready.js';
import { captureProblem, CaptureProblemError } from './capture-check.js';
import { buildDomSearchScript, buildXPathProbeScript, type DomHit, type DomNeedle, type XPathProbeResult } from './dom-scripts.js';
import { proposeWithAi } from './ai-fallback.js';
import { buildSelectionScript } from './variant-dom.js';
import { readsFixedVariant } from './page-variant-match.js';
import type { CertifiedPath, ConfirmedPath, FieldVerification, Mark, SchemaDefinitionField, VerificationOutcome, VerificationSet } from './types.js';

export type VerificationRequest = { fields: SchemaDefinitionField[]; verificationSet: VerificationSet };
export type VerificationDeps = {
  browser: IBrowser;
  agent: ProposePathsAgent | null;
  captures?: Record<string, PageCapture>;
  cachedPaths?: (concept: string) => Promise<CertifiedPath[]>;
  onlyKeys?: string[];
  previous?: VerificationOutcome;
  /** `ready` is the check built from this page's expected values (verification-ready.ts); a fake may ignore it. */
  captureOne?: (browser: IBrowser, url: string, ready?: ReadyCheck) => Promise<PageCapture>;
  onProgress?: (stage: string) => void;
  /** Spec 2026-10-17 §8/§10.9: never call the agent in this run, whatever `agent` is; a field nothing certifies fails. */
  free?: boolean;
};
export type VerificationRun = { outcome: VerificationOutcome; captures: Record<string, PageCapture | null>; captureErrors: Record<string, string> };

// `load` plus a ready check, never `networkidle`: a site that holds a
// connection open (Ikea) never goes idle and paid the full 60 s timeout on
// every proof page. The check waits for the values typed on this page instead.
const defaultCapture = (browser: IBrowser, url: string, ready?: ReadyCheck) => browser.capture(url, { waitUntil: 'load', interceptNetworkRequests: true, selection: buildSelectionScript(), ...(ready ? { ready } : {}) });

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The hash-relevant part of a field's marks on the given pages: paths and text, never the rect (an element that moved but kept its path is the same mark). Undefined when there are none, so a set without marks hashes byte-for-byte as before. */
function markDigest(marks: Record<string, Mark> | undefined, pages: string[]): Record<string, { xpaths: string[]; text: string }> | undefined {
  if (!marks) return undefined;
  const entries = pages.filter((u) => marks[u]).map((u) => [u, { xpaths: marks[u]!.xpaths, text: marks[u]!.text }] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** The hash-relevant part of a field's confirmed paths (spec 2026-09-29 C1) on the given pages, by url: source and path only. Undefined when there are none, so a set without `paths` hashes byte-for-byte as before. */
function pathDigest(paths: Record<string, ConfirmedPath> | undefined, pages: string[]): Record<string, ConfirmedPath> | undefined {
  if (!paths) return undefined;
  const entries = pages.filter((u) => paths[u]).sort().map((u) => [u, { source: paths[u]!.source, path: paths[u]!.path }] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Every field's confirmed-path digest over the set's pages, by field key; undefined when no field has one. */
function allPathDigests(set: VerificationSet): Record<string, Record<string, ConfirmedPath>> | undefined {
  const entries = Object.keys(set.paths ?? {}).sort()
    .map((k) => [k, pathDigest(set.paths![k], set.urls)] as const)
    .filter((e): e is readonly [string, Record<string, ConfirmedPath>] => e[1] !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** The distinct paths the customer confirmed for a field, across its pages. */
function confirmedPathsOf(set: VerificationSet, key: string): ConfirmedPath[] {
  const all = Object.values(set.paths?.[key] ?? {});
  return all.filter((p, i) => all.findIndex((q) => q.source === p.source && q.path === p.path) === i).map((p) => ({ source: p.source, path: p.path }));
}

/** Whole-definition hash, kept for history and the fast path. Excludes `name`: renaming is free (spec 4.3). */
export function definitionHash(fields: SchemaDefinitionField[], set: VerificationSet): string {
  const paths = allPathDigests(set);
  const defaultKeys = Object.keys(set.defaults ?? {}).filter((k) => (set.defaults![k] ?? '').trim() !== '').sort();
  const defaults = defaultKeys.length ? Object.fromEntries(defaultKeys.map((k) => [k, set.defaults![k]!.trim()])) : undefined;
  return sha256(JSON.stringify({
    fields: fields.map((f) => ({ key: f.key, type: f.type, description: f.description, concept: f.concept })),
    urls: set.urls,
    expected: Object.fromEntries(Object.keys(set.expected).sort().map((k) => [k, Object.fromEntries(Object.entries(set.expected[k]!).sort())])),
    listing_url: set.listing_url ?? null,
    ...(set.marks && Object.keys(set.marks).length ? { marks: Object.fromEntries(Object.keys(set.marks).sort().map((k) => [k, markDigest(set.marks![k], set.urls)])) } : {}),
    ...(paths ? { paths } : {}),
    ...(set.absent && Object.keys(set.absent).length ? { absent: Object.fromEntries(Object.keys(set.absent).sort().map((k) => [k, Object.keys(set.absent![k]!).sort()])) } : {}),
    ...(defaults ? { defaults } : {}),
  }));
}

/**
 * Per-field hash (spec 4.4; per-field pages since 2026-09-17): the field's own
 * definition, the pages IT is checked on, and its non-blank expected cells.
 * A page added for another field does not move this hash. For a field with a
 * value on every page the string is identical to the pre-2026-09-17 one, so
 * stored certifications stay current.
 */
export function fieldHash(field: SchemaDefinitionField, set: VerificationSet): string {
  const expected = set.expected[field.key] ?? {};
  const absent = Object.keys(set.absent?.[field.key] ?? {}).filter((u) => set.urls.includes(u)).sort();
  const def = (set.defaults?.[field.key] ?? '').trim();
  // A field with a default is checked on every proof page (spec 2026-10-13 §3).
  const pages = def ? [...set.urls] : checkedPages(set.urls, expected, Object.fromEntries(absent.map((u) => [u, true as const])));
  const marks = markDigest(set.marks?.[field.key], pages);
  const paths = pathDigest(set.paths?.[field.key], pages);
  return sha256(JSON.stringify({
    key: field.key,
    type: field.type,
    description: field.description,
    concept: field.concept,
    urls: pages,
    // With a default a blank cell is a default cell, so a stored blank and a missing key hash the same.
    // Without one the filter is exactly the pre-2026-10-13 one (a blank page is not in `pages` anyway).
    expected: Object.fromEntries(Object.entries(expected).filter(([u, v]) => pages.includes(u) && (!def || v.trim() !== '')).sort()),
    ...(marks ? { marks } : {}),
    ...(paths ? { paths } : {}),
    ...(absent.length ? { absent } : {}),
    ...(def ? { default: def } : {}),
  }));
}

/**
 * May this field's stored result be carried forward? Its hash already covers
 * the field's own pages and expected values; this is the defence-in-depth
 * guard that used to compare whole url lists. A stored cell is keyed by url,
 * so a result is reusable only while every page it was proven on is still a
 * proof page. A page ADDED for another field does not disturb it; a page
 * removed or replaced does. Erring toward re-verifying costs one free
 * mechanical pass, erring the other way costs correctness.
 */
function provenPagesStillPresent(prev: FieldVerification, urls: string[]): boolean {
  return Object.keys(prev.cells).every((u) => urls.includes(u));
}

/**
 * Did every captured, checked page fail because nothing could be told to be
 * this field (spec 2026-09-29 C2, `no_fitting_path`)? An AI XPath proposal
 * cannot rescue a weak field — an unmarked DOM hit never qualifies, whatever
 * it finds — so asking (and paying for) the model here is wasted: the
 * customer marks it instead.
 */
function everyCellNoFittingPath(result: FieldVerification): boolean {
  const captured = Object.values(result.cells).filter((c) => c.status !== 'not_captured');
  return captured.length > 0 && captured.every((c) => c.status === 'fail' && c.reason === 'no_fitting_path');
}

export async function runVerification(req: VerificationRequest, deps: VerificationDeps): Promise<VerificationRun> {
  const captureOne = deps.captureOne ?? defaultCapture;
  const captures: Record<string, PageCapture | null> = {};
  const captureErrors: Record<string, string> = {};
  for (const [i, url] of req.verificationSet.urls.entries()) {
    if (deps.captures?.[url]) { captures[url] = deps.captures[url]!; continue; }
    deps.onProgress?.(`capturing ${i + 1}/${req.verificationSet.urls.length}`);
    try {
      const expectedOnPage = Object.fromEntries(req.fields.map((f) => [f.key, req.verificationSet.expected[f.key]?.[url] ?? '']));
      const c = await captureOne(deps.browser, url, buildVerificationReadyCheck(req.fields, expectedOnPage, url));
      const problem = captureProblem(c, url);
      if (problem) { captures[url] = null; captureErrors[url] = problem.reason; continue; }
      captures[url] = c;
    } catch (err) {
      captures[url] = null;
      // Spec 2026-10-20 §3.5.2: what is stored is what the customer reads. A CaptureError or a
      // CaptureProblemError already carries the verdict's sentence; anything else is library text,
      // which goes to the log only.
      const sentence = err instanceof CaptureError || err instanceof CaptureProblemError;
      if (!sentence) console.error(`[verify] capturing ${url} failed:`, err);
      captureErrors[url] = sentence ? err.message : BROWSER_UNAVAILABLE;
    }
  }

  const evalXPaths = (html: string, xpaths: string[]) => deps.browser.setContentEvaluate<XPathProbeResult>(html, buildXPathProbeScript(xpaths));
  const runDomSearch = (html: string, needles: DomNeedle[], pageUrl: string) => deps.browser.setContentEvaluate<DomHit[]>(html, buildDomSearchScript(needles, pageUrl));

  // Spec 2026-10-17 §10 property 9: a free run (the address warning's re-verify) never reaches the AI, for any field.
  const agent = deps.free ? null : deps.agent;
  const fields: Record<string, FieldVerification> = {};
  let aiCalls = 0;
  deps.onProgress?.('searching');
  for (const field of req.fields) {
    const fh = fieldHash(field, req.verificationSet);
    const prev = deps.previous?.fields[field.key];
    if (deps.onlyKeys && !deps.onlyKeys.includes(field.key) && prev && prev.fieldHash === fh && provenPagesStillPresent(prev, req.verificationSet.urls)) {
      fields[field.key] = prev;
      continue;
    }
    const absent = Object.keys(req.verificationSet.absent?.[field.key] ?? {});
    const defaultValue = (req.verificationSet.defaults?.[field.key] ?? '').trim() || undefined;
    // With a default the search looks for it on every blank page (spec 2026-10-13 §4): the JSON-LD brand path is found where nothing was typed.
    const expected = expectedWithDefault(req.verificationSet.urls, req.verificationSet.expected[field.key] ?? {}, defaultValue, Object.fromEntries(absent.map((u) => [u, true as const])));
    const caps: Record<string, CaptureLike | null> = captures;
    // What the customer said about this field (spec 2026-09-29 C1/C2) goes to every certification
    // below, the domain-cache shortcut included: that is where a cached `priority` would slip in.
    const confirmed = confirmedPathsOf(req.verificationSet, field.key);
    const markXPaths = Object.values(req.verificationSet.marks?.[field.key] ?? {}).flatMap((m) => markPaths(field, m));

    let result: FieldVerification | null = null;
    const cached = deps.cachedPaths ? await deps.cachedPaths(field.concept) : [];
    if (cached.length > 0) {
      const r = await certify({ field, expected, captures: caps, candidates: cached, confirmed, markXPaths, absent, defaultValue }, { evalXPaths });
      // The shortcut is for a certification worth keeping. One that rests on a
      // volatile XPath (only possible as certify's last resort) is searched
      // again, so the stable paths the generator now finds can replace it.
      // Spec 2026-10-17 §8: a fixed variant index on a proof page whose address names a variant reads
      // the first variant whatever the address says; search again, so the [page] path can replace it.
      const namedVariant = Object.values(caps).some((c) => c?.pageVariant?.named === true);
      // Spec 2026-10-20 one-source §3.4: nor one that reads one source with two or more paths (Ikea's API
      // siblings): search again — free, the AI is asked only when nothing certifies — so another source can
      // join as a backup. Where the pages offer no other source the result is the same pair. Two or more
      // XPaths alone read one source too — the page's HTML (spec 2026-10-21 xpath-cap).
      if (r.certified.length > 0 && !r.certified.some(isVolatilePath) && !(namedVariant && r.certified.some(readsFixedVariant)) && !readsOneSource(r.certified)) result = r;
    }
    let candidates: CandidatePath[] = [];
    if (!result) {
      const gathered = await gatherCandidates(field, expected, caps, { runDomSearch, marks: req.verificationSet.marks?.[field.key] });
      candidates = [...cached, ...gathered.candidates];
      result = await certify({ field, expected, captures: caps, candidates, confirmed, markXPaths, absent, defaultValue }, { evalXPaths });
    }
    if (result.certified.length === 0 && !result.defaultOnly && !result.notOnWebsite && !result.incomplete && agent && !everyCellNoFittingPath(result)) {
      deps.onProgress?.(`asking AI for ${field.key}`);
      const nearMisses = Object.fromEntries(Object.entries(result.cells).map(([u, c]) => [u, c.status === 'fail' ? c.nearMisses ?? [] : []]));
      // I1: only the pages this field is actually checked on go to the model
      // — a page blank for this field (allowed on pages four to six) is not
      // this field's business, costs nothing to search, and just inflates
      // the prompt and its cost.
      const pages = checkedPages(req.verificationSet.urls, expected);
      const checkedExpected = Object.fromEntries(pages.map((u) => [u, expected[u]!]));
      const checkedCaps: Record<string, CaptureLike | null> = Object.fromEntries(pages.map((u) => [u, caps[u] ?? null]));
      let proposals: CandidatePath[];
      try {
        proposals = await proposeWithAi({ field, expected: checkedExpected, captures: checkedCaps, nearMisses }, agent);
      } catch (err) {
        // Spec 2026-10-24 metering §2.3: the organisation's monthly limit refused the call before it was sent —
        // nothing was billed, so it is not counted and the field was not asked; it is `ai_unavailable`, and the rest
        // of the Verify carries on.
        if (isCapReached(err)) {
          fields[field.key] = { ...result, failReason: 'ai_unavailable', fieldHash: fh };
          continue;
        }
        // Spec 2026-10-20 §3.3: one field's AI failure is that field's result, never the run's. Its
        // result without the AI stands, the call is counted (it may have been billed), and every
        // other field, every capture and the cost record are kept.
        console.error(`[verify] the AI proposal for ${field.key} failed:`, err);
        aiCalls++;
        fields[field.key] = { ...result, aiCalled: true, failReason: 'ai_unavailable', fieldHash: fh };
        continue;
      }
      aiCalls++;
      result = await certify({ field, expected, captures: caps, candidates: [...candidates, ...proposals], confirmed, markXPaths, absent, defaultValue }, { evalXPaths });
      result.aiCalled = true;
    }
    fields[field.key] = { ...result, fieldHash: fh };
  }

  const allPassed = req.fields.length > 0 && Object.values(fields).every((f) => (f.certified.length > 0 || f.defaultOnly === true || f.notOnWebsite === true) && Object.values(f.cells).every((c) => c.status === 'pass'));
  return { outcome: { fields, allPassed, aiCalls }, captures, captureErrors };
}
