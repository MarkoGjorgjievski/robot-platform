import { createHash } from 'node:crypto';
import { checkPageHealth } from '@robot/browser';
import type { IBrowser, PageCapture, ReadyCheck } from '@robot/browser';
import type { ProposePathsAgent } from '@robot/agent';
import { certify, checkedPages, gatherCandidates, type CandidatePath, type CaptureLike } from './certify.js';
import { buildVerificationReadyCheck } from './verification-ready.js';
import { buildDomSearchScript, buildXPathProbeScript, type DomHit, type DomNeedle, type XPathProbeResult } from './dom-scripts.js';
import { proposeWithAi } from './ai-fallback.js';
import type { CertifiedPath, FieldVerification, SchemaDefinitionField, VerificationOutcome, VerificationSet } from './types.js';

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
};
export type VerificationRun = { outcome: VerificationOutcome; captures: Record<string, PageCapture | null>; captureErrors: Record<string, string> };

// `load` plus a ready check, never `networkidle`: a site that holds a
// connection open (Ikea) never goes idle and paid the full 60 s timeout on
// every proof page. The check waits for the values typed on this page instead.
const defaultCapture = (browser: IBrowser, url: string, ready?: ReadyCheck) => browser.capture(url, { waitUntil: 'load', interceptNetworkRequests: true, ...(ready ? { ready } : {}) });

/** Same host and path (trailing slash and fragment ignored; query ignored — many shops append tracking params). */
function samePath(finalUrl: string, requested: string): boolean {
  try {
    const a = new URL(finalUrl); const b = new URL(requested);
    const norm = (p: string) => p.replace(/\/+$/, '') || '/';
    return a.hostname.toLowerCase() === b.hostname.toLowerCase() && norm(a.pathname) === norm(b.pathname);
  } catch { return false; }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Whole-definition hash, kept for history and the fast path. Excludes `name`: renaming is free (spec 4.3). */
export function definitionHash(fields: SchemaDefinitionField[], set: VerificationSet): string {
  return sha256(JSON.stringify({
    fields: fields.map((f) => ({ key: f.key, type: f.type, description: f.description, concept: f.concept })),
    urls: set.urls,
    expected: Object.fromEntries(Object.keys(set.expected).sort().map((k) => [k, Object.fromEntries(Object.entries(set.expected[k]!).sort())])),
    listing_url: set.listing_url ?? null,
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
  const pages = checkedPages(set.urls, expected);
  return sha256(JSON.stringify({
    key: field.key,
    type: field.type,
    description: field.description,
    concept: field.concept,
    urls: pages,
    expected: Object.fromEntries(Object.entries(expected).filter(([u]) => pages.includes(u)).sort()),
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
      // Spec §4.1: a capture that landed on a different path (category page,
      // block page) is not this product page. `PageCapture.url` is the FINAL
      // url — `PlaywrightBrowser.capture` sets it from `page.url()` after
      // navigation (playwright-browser.ts ~265) — so this comparison bites.
      if (!samePath(c.url, url)) {
        captures[url] = null;
        captureErrors[url] = `redirected to ${c.url}`;
        continue;
      }
      // I4: a block page, CAPTCHA interstitial or soft 404 served AT the
      // requested path passes `samePath` and used to be handed to the
      // certifier as if it were the product page — where every field then
      // failed `not_found`, blaming the customer's expected values for a
      // page we never actually got. The same `checkPageHealth` the extraction
      // chain has always used says so plainly: `not_captured`, with the
      // block's own reason, and the amber "could not be captured" banner the
      // Schema screen already renders for a redirect.
      const health = checkPageHealth(c.html, c.title, url);
      if (!health.healthy) {
        captures[url] = null;
        captureErrors[url] = health.reason ?? 'page is not usable';
        continue;
      }
      captures[url] = c;
    } catch (err) { captures[url] = null; captureErrors[url] = err instanceof Error ? err.message : String(err); }
  }

  const evalXPaths = (html: string, xpaths: string[]) => deps.browser.setContentEvaluate<XPathProbeResult>(html, buildXPathProbeScript(xpaths));
  const runDomSearch = (html: string, needles: DomNeedle[], pageUrl: string) => deps.browser.setContentEvaluate<DomHit[]>(html, buildDomSearchScript(needles, pageUrl));

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
    const expected = req.verificationSet.expected[field.key] ?? {};
    const caps: Record<string, CaptureLike | null> = captures;

    let result: FieldVerification | null = null;
    const cached = deps.cachedPaths ? await deps.cachedPaths(field.concept) : [];
    if (cached.length > 0) {
      const r = await certify({ field, expected, captures: caps, candidates: cached }, { evalXPaths });
      if (r.certified.length > 0) result = r;
    }
    let candidates: CandidatePath[] = [];
    if (!result) {
      const gathered = await gatherCandidates(field, expected, caps, { runDomSearch });
      candidates = [...cached, ...gathered.candidates];
      result = await certify({ field, expected, captures: caps, candidates }, { evalXPaths });
    }
    if (result.certified.length === 0 && !result.incomplete && deps.agent) {
      deps.onProgress?.(`asking AI for ${field.key}`);
      const nearMisses = Object.fromEntries(Object.entries(result.cells).map(([u, c]) => [u, c.status === 'fail' ? c.nearMisses ?? [] : []]));
      // I1: only the pages this field is actually checked on go to the model
      // — a page blank for this field (allowed on pages four to six) is not
      // this field's business, costs nothing to search, and just inflates
      // the prompt and its cost.
      const pages = checkedPages(req.verificationSet.urls, expected);
      const checkedExpected = Object.fromEntries(pages.map((u) => [u, expected[u]!]));
      const checkedCaps: Record<string, CaptureLike | null> = Object.fromEntries(pages.map((u) => [u, caps[u] ?? null]));
      const proposals = await proposeWithAi({ field, expected: checkedExpected, captures: checkedCaps, nearMisses }, deps.agent);
      aiCalls++;
      result = await certify({ field, expected, captures: caps, candidates: [...candidates, ...proposals] }, { evalXPaths });
      result.aiCalled = true;
    }
    fields[field.key] = { ...result, fieldHash: fh };
  }

  const allPassed = req.fields.length > 0 && Object.values(fields).every((f) => f.certified.length > 0 && Object.values(f.cells).every((c) => c.status === 'pass'));
  return { outcome: { fields, allPassed, aiCalls }, captures, captureErrors };
}
