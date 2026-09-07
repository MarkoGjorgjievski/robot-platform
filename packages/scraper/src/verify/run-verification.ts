import { createHash } from 'node:crypto';
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

export function definitionHash(fields: SchemaDefinitionField[], set: VerificationSet): string {
  const canon = JSON.stringify({
    fields: fields.map((f) => ({ key: f.key, name: f.name, type: f.type, description: f.description, concept: f.concept })),
    urls: set.urls,
    expected: Object.fromEntries(Object.keys(set.expected).sort().map((k) => [k, Object.fromEntries(Object.entries(set.expected[k]!).sort())])),
    listing_url: set.listing_url ?? null,
  });
  return createHash('sha256').update(canon).digest('hex');
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
      // block page) is not this product page. `PageCapture.url` must be the
      // FINAL url for this to bite — check `PlaywrightBrowser.capture` sets it
      // from `page.url()` after navigation; if it only echoes the request, set
      // it there first (one line) and cover it in browser's own tests.
      if (samePath(c.url, url)) captures[url] = c;
      else { captures[url] = null; captureErrors[url] = `redirected to ${c.url}`; }
    } catch (err) { captures[url] = null; captureErrors[url] = err instanceof Error ? err.message : String(err); }
  }

  const evalXPaths = (html: string, xpaths: string[]) => deps.browser.setContentEvaluate<XPathProbeResult>(html, buildXPathProbeScript(xpaths));
  const runDomSearch = (html: string, needles: DomNeedle[], pageUrl: string) => deps.browser.setContentEvaluate<DomHit[]>(html, buildDomSearchScript(needles, pageUrl));

  const fields: Record<string, FieldVerification> = {};
  let aiCalls = 0;
  deps.onProgress?.('searching');
  for (const field of req.fields) {
    if (deps.onlyKeys && !deps.onlyKeys.includes(field.key) && deps.previous?.fields[field.key]) {
      fields[field.key] = deps.previous.fields[field.key]!;
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
    fields[field.key] = result;
  }

  const allPassed = req.fields.length > 0 && Object.values(fields).every((f) => f.certified.length > 0 && Object.values(f.cells).every((c) => c.status === 'pass'));
  return { outcome: { fields, allPassed, aiCalls }, captures, captureErrors };
}
