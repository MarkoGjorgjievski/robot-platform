// packages/scraper/src/verify/verified-extraction.ts
// Certified-only extraction at scale: given a Source's certified paths (Task
// 8's runVerification output, loaded per-run by loadCurrentCertification),
// this evaluates ONLY those paths against a live page — never the cache/AI
// extraction chain, never a fresh search. A path that no longer resolves is
// an honest miss (null in the row, drift's raw material) — not a cue to fall
// back to anything else.
//
// The capture waits for the values it needs, not for the page to go quiet:
// every path is known up front, so the browser polls the live page until each
// certified field resolves (`buildReadyCheck`) instead of sitting out the
// networkidle timeout on a site that never goes idle (Ikea, 2026-09-15:
// 69.8 s → 7.0 s per product page for identical data). It also takes the
// per-domain politeness lock the analysis chain takes, which this path used
// to bypass.

import { pageVariantFrom, verdictSentence, type CaptureTimings, type IBrowser, type PageCapture, type PageVariant, type ReadyCheck, type ReadySnapshot } from '@robot/browser';
import { acquireDomainLock, reportVerdict } from '../domain-lock.js';
import { CaptureProblemError } from './capture-check.js';
import { normalize, renderValue } from './normalize.js';
import { applyTransform } from './transforms.js';
import { applyDefaults } from './defaults.js';
import { resolveStructured } from './search-structured.js';
import { buildXPathProbeScript, type XPathProbeResult } from './dom-scripts.js';
import { pageTextOf, shownOnPage, type Shown } from './shown-on-page.js';
import type { CertifiedPath, CustomerFieldType } from './types.js';

export type VerifiedField = {
  key: string; type: CustomerFieldType; concept: string; paths: CertifiedPath[];
  /** The website's default (spec 2026-10-13 §5): written when every path misses; such a field never blocks readiness unless no other field would wait. */
  defaultValue?: string;
};
export type VerifiedExtractionResult = {
  data: Record<string, unknown>;
  stats: Array<{ key: string; concept: string; path: CertifiedPath; hit: boolean; value?: unknown }>;
  /** The live capture's timings; null when the caller supplied the capture. */
  timings: CaptureTimings | null;
  /** The capture this extraction used: the one the caller supplied, or the one it took. */
  capture: PageCapture | null;
  /** Per field: is the written value on the page's rendered text? null when the
   * field's type is not checked (url/image/boolean/date), or there was no hit
   * to check (spec 2026-10-12 §3). Never changes `data` or `stats`. */
  shown: Record<string, Shown>;
  /** The field keys the website's default filled (spec §5): every certified path missed there. `[]` on a run with no defaults. */
  defaulted: string[];
};

type Structured = Pick<PageCapture, 'structuredData' | 'interceptedRequests'>;

/** One certified path against one page: the rendered value, or null for a miss.
 * The same evaluation serves the ready check and the final row, so "ready"
 * means exactly "would produce a value", placeholders included. */
function evaluatePath(
  field: VerifiedField,
  path: CertifiedPath,
  structured: Structured,
  probe: XPathProbeResult,
  ctx: { pageUrl: string; pageVariant?: PageVariant },
): unknown {
  const rawBase = path.source === 'xpath' ? probe[path.path] ?? null : resolveStructured(structured, path.source, path.path, ctx);
  const raw = applyTransform(rawBase, path.transform);
  const norm = raw === null || raw === undefined || raw === '' ? null : normalize(field.type, raw, ctx);
  if (norm === null) return null;
  return field.type === 'text' ? String(raw).normalize('NFKC').replace(/\s+/g, ' ').trim() : renderValue(field.type, norm);
}

function certifiedXPaths(fields: VerifiedField[]): string[] {
  return [...new Set(fields.flatMap((f) => f.paths.filter((p) => p.source === 'xpath').map((p) => p.path)))];
}

/** The ready check for a set of certified fields: probe every certified
 * xpath in the live page, and call the page ready once every field that has
 * a certified path resolves through at least one of them. A field with no
 * certified path can never be filled, so it never blocks readiness. A field
 * with a default never blocks readiness either, unless every certified field
 * has one: then the check waits for those fields' paths instead. A `[page]`
 * path reads by `pageVariant` (spec 2026-10-14 §4); before the capture only
 * the address's part of it is known. */
export function buildReadyCheck(fields: VerifiedField[], pageUrl: string, pageVariant?: PageVariant): ReadyCheck {
  const withPaths = fields.filter((f) => f.paths.length > 0);
  // Spec 2026-10-13 §5: a field with a default never blocks readiness — its paths may legitimately never resolve on this product — unless no other field would wait at all.
  const blocking = withPaths.filter((f) => f.defaultValue === undefined);
  const certified = blocking.length > 0 ? blocking : withPaths;
  const ctx = { pageUrl, pageVariant };
  return {
    script: buildXPathProbeScript(certifiedXPaths(fields)),
    isReady: (s: ReadySnapshot) => {
      const probe = (s.probe ?? {}) as XPathProbeResult;
      return certified.every((f) => f.paths.some((p) => evaluatePath(f, p, s, probe, ctx) !== null));
    },
  };
}

export async function runVerifiedExtraction(
  req: { url: string; fields: VerifiedField[] },
  deps: { browser: IBrowser; capture?: PageCapture; acquireLock?: typeof acquireDomainLock },
): Promise<VerifiedExtractionResult> {
  const capture = deps.capture ?? await captureUnderLock(req, deps);
  // A page that is not the product page (a wall, a 404, an empty page, another
  // site) is a failed item with its one sentence, never a row of misses: no
  // path is evaluated, so no certified path's hit rate counts a wall against
  // it (review C1, 2026-10-09). Thrown after captureUnderLock reported the
  // verdict, so the host's backoff still learns. A capture the caller supplied
  // (variant-check's proof page) was already judged by its own taker.
  if (!deps.capture && capture.verdict.kind !== 'ok') {
    throw new CaptureProblemError(verdictSentence(capture.verdict, req.url), capture.verdict);
  }
  const xpaths = certifiedXPaths(req.fields);
  const probe: XPathProbeResult = xpaths.length ? await deps.browser.setContentEvaluate<XPathProbeResult>(capture.html, buildXPathProbeScript(xpaths)) : {};
  const ctx = { pageUrl: capture.url, pageVariant: capture.pageVariant };
  const data: Record<string, unknown> = {};
  const stats: VerifiedExtractionResult['stats'] = [];
  for (const f of req.fields) {
    data[f.key] = null;
    for (const p of f.paths) {
      const value = evaluatePath(f, p, capture, probe, ctx);
      if (value === null) { stats.push({ key: f.key, concept: f.concept, path: p, hit: false }); continue; }
      data[f.key] = value;
      stats.push({ key: f.key, concept: f.concept, path: p, hit: true, value });
      break;
    }
  }
  const applied = applyDefaults(data, req.fields);
  const pageText = pageTextOf(capture.html);
  const shown: Record<string, Shown> = {};
  for (const f of req.fields) {
    const hit = stats.find((s) => s.key === f.key && s.hit);
    shown[f.key] = hit ? shownOnPage(f, hit.path, hit.value, pageText) : null;
  }
  return { data: applied.row, stats, timings: deps.capture ? null : capture.timings ?? null, capture, shown, defaulted: applied.defaulted };
}

async function captureUnderLock(
  req: { url: string; fields: VerifiedField[] },
  deps: { browser: IBrowser; acquireLock?: typeof acquireDomainLock },
): Promise<PageCapture> {
  const host = new URL(req.url).hostname;
  const release = await (deps.acquireLock ?? acquireDomainLock)(host);
  try {
    const capture = await deps.browser.capture(req.url, {
      waitUntil: 'load',
      interceptNetworkRequests: true,
      // The picker's selection is unknown until the page is captured; the address's part is what `[page]` needs on a Shopify `?variant=` page.
      ready: buildReadyCheck(req.fields, req.url, pageVariantFrom(req.url, null, {})),
    });
    // Feed the verdict back to the host's pacing (a challenge or refusal
    // backs the next acquire off; an ok clears it).
    reportVerdict(host, capture.verdict);
    return capture;
  } finally {
    release();
  }
}
