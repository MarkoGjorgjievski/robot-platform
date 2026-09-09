import { createHash } from 'node:crypto';
import { checkPageHealth } from '@robot/browser';
import type { IBrowser, PageCapture } from '@robot/browser';
import type { ProposePathsAgent } from '@robot/agent';
import { certify, gatherCandidates, type CandidatePath, type CaptureLike } from './certify.js';
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
  /**
   * The urls the `previous` outcome was actually proven against. When given
   * and different from `verificationSet.urls`, the `onlyKeys` copy path is
   * ignored and every field re-runs — see `previousIsStale` below.
   */
  previousUrls?: string[];
  captureOne?: (browser: IBrowser, url: string) => Promise<PageCapture>;
  onProgress?: (stage: string) => void;
};
export type VerificationRun = { outcome: VerificationOutcome; captures: Record<string, PageCapture | null>; captureErrors: Record<string, string> };

const defaultCapture = (browser: IBrowser, url: string) => browser.capture(url, { waitUntil: 'networkidle', interceptNetworkRequests: true });

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

/** Per-field hash (spec 4.4): the field's own definition, the pages, and only its expected cells. */
export function fieldHash(field: SchemaDefinitionField, set: VerificationSet): string {
  return sha256(JSON.stringify({
    key: field.key,
    type: field.type,
    description: field.description,
    concept: field.concept,
    urls: set.urls,
    expected: Object.fromEntries(Object.entries(set.expected[field.key] ?? {}).sort()),
  }));
}

/**
 * Do the urls the `previous` outcome was proven against still match the ones
 * we are about to verify? A stored cell result is keyed by url, so once the
 * url set moves, NONE of the previous field results describe these pages —
 * copying them forward would store yesterday's evidence under today's
 * definition hash and unlock Extract against pages nobody verified.
 *
 * Order-sensitive on purpose. A pure reordering is arguably harmless (cells
 * are a map, not a list), but this is a defence-in-depth guard: erring
 * toward re-verifying costs one free mechanical pass, while erring the other
 * way costs correctness. Absent `previousUrls` (an older caller), the guard
 * never fires and behaviour is unchanged.
 */
function previousIsStale(previousUrls: string[] | undefined, urls: string[]): boolean {
  if (!previousUrls) return false;
  return previousUrls.length !== urls.length || previousUrls.some((u, i) => u !== urls[i]);
}

export async function runVerification(req: VerificationRequest, deps: VerificationDeps): Promise<VerificationRun> {
  const captureOne = deps.captureOne ?? defaultCapture;
  const captures: Record<string, PageCapture | null> = {};
  const captureErrors: Record<string, string> = {};
  for (const [i, url] of req.verificationSet.urls.entries()) {
    if (deps.captures?.[url]) { captures[url] = deps.captures[url]!; continue; }
    deps.onProgress?.(`capturing ${i + 1}/${req.verificationSet.urls.length}`);
    try {
      const c = await captureOne(deps.browser, url);
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
  // The dashboard already forces a full re-verify when the urls move
  // (`reverifyKeys`), but a scoped re-verify that reuses results proven
  // against DIFFERENT pages is wrong however the request got here.
  const reuseAllowed = !previousIsStale(deps.previousUrls, req.verificationSet.urls);
  for (const field of req.fields) {
    const fh = fieldHash(field, req.verificationSet);
    const prev = deps.previous?.fields[field.key];
    if (reuseAllowed && deps.onlyKeys && !deps.onlyKeys.includes(field.key) && prev && prev.fieldHash === fh) {
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
      const proposals = await proposeWithAi({ field, expected, captures: caps, nearMisses }, deps.agent);
      aiCalls++;
      result = await certify({ field, expected, captures: caps, candidates: [...candidates, ...proposals] }, { evalXPaths });
      result.aiCalled = true;
    }
    fields[field.key] = { ...result, fieldHash: fh };
  }

  const allPassed = req.fields.length > 0 && Object.values(fields).every((f) => f.certified.length > 0 && Object.values(f.cells).every((c) => c.status === 'pass'));
  return { outcome: { fields, allPassed, aiCalls }, captures, captureErrors };
}
