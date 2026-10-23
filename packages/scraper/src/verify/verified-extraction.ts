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
//
// A run passes its lean state (spec 2026-10-23 run speed): a lean capture first — no popup rounds, no pictures,
// the XPaths in the live tab — and today's full capture of the same page when a field is missing, a value is not
// shown, the verdict is not ok (a wall excepted), or the run is still checking that lean reads as full does.

import { pageVariantFrom, verdictSentence, type CaptureOptions, type CaptureTimings, type IBrowser, type PageCapture, type PageVariant, type ReadyCheck, type ReadySnapshot } from '@robot/browser';
import { acquireDomainLock, reportVerdict } from '../domain-lock.js';
import { CaptureProblemError } from './capture-check.js';
import { normalize, renderValue } from './normalize.js';
import { applyTransform } from './transforms.js';
import { applyDefaults } from './defaults.js';
import { resolveStructured } from './search-structured.js';
import { buildXPathProbeScript, type XPathProbeResult } from './dom-scripts.js';
import { buildSelectionScript } from './variant-dom.js';
import { pageTextOf, shownOnPage, type Shown } from './shown-on-page.js';
import type { CertifiedPath, CustomerFieldType } from './types.js';
import { LEAN_FIRST_PATH_MS, fallbackFor, learn, recordOutcome, type FieldReading, type LeanOutcome, type LeanReason, type LeanRunState } from './lean-run.js';

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
  /** What the run's lean state chose for this page (spec 2026-10-23 run speed §3.5); absent without a lean state. */
  lean?: LeanOutcome;
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

/** `index` is `page` with exactly one `[page]` step replaced by a numeric index (`hasVariant[1].offers.price` / `hasVariant[page].offers.price`). */
function isIndexTwin(index: CertifiedPath, page: CertifiedPath): boolean {
  if (index.source !== page.source || !page.path.includes('[page]')) return false;
  for (const m of index.path.matchAll(/\[\d+\]/g)) {
    if (index.path.slice(0, m.index) + '[page]' + index.path.slice(m.index + m[0].length) === page.path) return true;
  }
  return false;
}

/**
 * The paths a field is read by on this page. On a page that names or shows a
 * variant, a certified index path whose `[page]` twin is also certified is
 * skipped: when `[page]` misses, the index would write some other variant's
 * value (final review I3). With no page variant every path is read.
 */
function pathsFor(field: VerifiedField, pageVariant?: PageVariant): CertifiedPath[] {
  if (!pageVariant || (!pageVariant.named && !pageVariant.selected)) return field.paths;
  return field.paths.filter((p) => !field.paths.some((q) => q !== p && isIndexTwin(p, q)));
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
 * the address's part of it is known; an index path whose `[page]` twin
 * is certified is skipped on a named page, as the extraction skips it.
 * With `opts.preferFirstPathMs` (lean captures), it then waits up to that long for each field's first path. */
export function buildReadyCheck(
  fields: VerifiedField[],
  pageUrl: string,
  pageVariant?: PageVariant,
  opts: { preferFirstPathMs?: number; now?: () => number } = {},
): ReadyCheck {
  const withPaths = fields.filter((f) => f.paths.length > 0);
  // Spec 2026-10-13 §5: a field with a default never blocks readiness — its paths may legitimately never resolve on this product — unless no other field would wait at all.
  const blocking = withPaths.filter((f) => f.defaultValue === undefined);
  const certified = blocking.length > 0 ? blocking : withPaths;
  const ctx = { pageUrl, pageVariant };
  const now = opts.now ?? Date.now;
  // Spec 2026-10-23 run speed §3.2: a lean capture reads at once, so a later, higher-ranked path (an API that
  // lands after the JSON-LD) would lose to a lower one it beats on a full capture. With preferFirstPathMs the
  // check, once it would pass, waits up to that long for every field's FIRST path. Per capture: a fresh check each time.
  let basicSince: number | null = null;
  return {
    script: buildXPathProbeScript(certifiedXPaths(fields)),
    isReady: (s: ReadySnapshot) => {
      const probe = (s.probe ?? {}) as XPathProbeResult;
      if (!certified.every((f) => pathsFor(f, pageVariant).some((p) => evaluatePath(f, p, s, probe, ctx) !== null))) return false;
      if (!opts.preferFirstPathMs) return true;
      const firstPaths = withPaths.every((f) => {
        const first = pathsFor(f, pageVariant)[0];
        return first === undefined || evaluatePath(f, first, s, probe, ctx) !== null;
      });
      if (firstPaths) return true;
      basicSince ??= now();
      return now() - basicSince >= opts.preferFirstPathMs;
    },
  };
}

type Evaluated = { data: Record<string, unknown>; stats: VerifiedExtractionResult['stats']; shown: Record<string, Shown> };

/** Every field from one capture and its XPath probe — the first certified path that reads wins — and the shown flags. `data` is before defaults. */
function evaluateCapture(fields: VerifiedField[], capture: PageCapture, probe: XPathProbeResult): Evaluated {
  const ctx = { pageUrl: capture.url, pageVariant: capture.pageVariant };
  const data: Record<string, unknown> = {};
  const stats: VerifiedExtractionResult['stats'] = [];
  for (const f of fields) {
    data[f.key] = null;
    for (const p of pathsFor(f, capture.pageVariant)) {
      const value = evaluatePath(f, p, capture, probe, ctx);
      if (value === null) { stats.push({ key: f.key, concept: f.concept, path: p, hit: false }); continue; }
      data[f.key] = value;
      stats.push({ key: f.key, concept: f.concept, path: p, hit: true, value });
      break;
    }
  }
  const pageText = pageTextOf(capture.html);
  const shown: Record<string, Shown> = {};
  for (const f of fields) {
    const hit = stats.find((s) => s.key === f.key && s.hit);
    shown[f.key] = hit ? shownOnPage(f, hit.path, hit.value, pageText) : null;
  }
  return { data, stats, shown };
}

const readingsOf = (fields: VerifiedField[], ev: Evaluated): FieldReading[] =>
  fields.map((f) => ({ key: f.key, value: ev.data[f.key] ?? null, shown: ev.shown[f.key] ?? null, hasPaths: f.paths.length > 0 }));

function finish(fields: VerifiedField[], ev: Evaluated, capture: PageCapture, timings: CaptureTimings | null, lean?: LeanOutcome): VerifiedExtractionResult {
  const applied = applyDefaults(ev.data, fields);
  return { data: applied.row, stats: ev.stats, timings, capture, shown: ev.shown, defaulted: applied.defaulted, ...(lean ? { lean } : {}) };
}

/**
 * A page that is not the product page (a wall, a 404, an empty page, another site) is a failed item with its one
 * sentence, never a row of misses: no path is evaluated, so no certified path's hit rate counts a wall against it
 * (review C1, 2026-10-09). Thrown after captureUnderLock reported the verdict, so the host's backoff still learns.
 */
function throwUnlessOk(capture: PageCapture, url: string): void {
  if (capture.verdict.kind !== 'ok') throw new CaptureProblemError(verdictSentence(capture.verdict, url), capture.verdict);
}

export async function runVerifiedExtraction(
  req: { url: string; fields: VerifiedField[] },
  deps: { browser: IBrowser; capture?: PageCapture; acquireLock?: typeof acquireDomainLock; lean?: LeanRunState },
): Promise<VerifiedExtractionResult> {
  const xpaths = certifiedXPaths(req.fields);
  // Today's evaluation: the saved HTML rendered again, offline, and the certified XPaths run there.
  const renderedProbe = async (c: PageCapture): Promise<XPathProbeResult> =>
    xpaths.length ? await deps.browser.setContentEvaluate<XPathProbeResult>(c.html, buildXPathProbeScript(xpaths)) : {};

  // A capture the caller supplied (variant-check's proof page, holds) was already judged by its own taker.
  if (deps.capture) return finish(req.fields, evaluateCapture(req.fields, deps.capture, await renderedProbe(deps.capture)), deps.capture, null);

  const state = deps.lean;
  const takeFull = async () => {
    const capture = await captureUnderLock(req, deps, state ? 'full-no-pictures' : 'full');
    throwUnlessOk(capture, req.url);
    return { capture, ev: evaluateCapture(req.fields, capture, await renderedProbe(capture)) };
  };

  if (!state || state.mode === 'full') {
    const { capture, ev } = await takeFull();
    const outcome = state ? recordOutcome(state, { mode: 'full', reason: state.why, fields: [], leanMs: null }) : undefined;
    return finish(req.fields, ev, capture, capture.timings ?? null, outcome);
  }

  // Spec 2026-10-23 run speed §3.3: the lean capture first; today's full capture only when the rules say so.
  const leanCapture = await captureUnderLock(req, deps, 'lean');
  const leanMs = leanCapture.timings?.totalMs ?? null;
  const kind = leanCapture.verdict.kind;
  // A wall is never loaded twice: its sentence now, its verdict already fed to the host's backoff.
  if (kind === 'challenge' || kind === 'refused') throwUnlessOk(leanCapture, req.url);

  let reason: LeanReason = 'verdict';
  let fields: string[] = [];
  let leanReadings: FieldReading[] | null = null;
  if (kind === 'ok') {
    const ev = evaluateCapture(req.fields, leanCapture, (leanCapture.probe ?? {}) as XPathProbeResult);
    leanReadings = readingsOf(req.fields, ev);
    const fallback = fallbackFor(state, leanReadings);
    if (!fallback) return finish(req.fields, ev, leanCapture, leanCapture.timings ?? null, recordOutcome(state, { mode: 'lean', reason: null, fields: [], leanMs }));
    reason = fallback.reason;
    fields = fallback.fields;
  }

  // Everything written comes from the full capture: data, shown, defaults, path stats (a rescued miss never
  // counts against a healthy path) and the capture variants read.
  const { capture, ev } = await takeFull();
  if (leanReadings) {
    const learned = learn(state, leanReadings, readingsOf(req.fields, ev), { check: reason === 'check', url: req.url });
    if (reason === 'check') fields = learned.disagreed;
  }
  return finish(req.fields, ev, capture, capture.timings ?? null, recordOutcome(state, { mode: 'lean+full', reason, fields, leanMs }));
}

async function captureUnderLock(
  req: { url: string; fields: VerifiedField[] },
  deps: { browser: IBrowser; acquireLock?: typeof acquireDomainLock },
  kind: 'full' | 'full-no-pictures' | 'lean',
): Promise<PageCapture> {
  const host = new URL(req.url).hostname;
  // The picker's selection is unknown until the page is captured; the address's part is what `[page]` needs on a Shopify `?variant=` page.
  const pageVariant = pageVariantFrom(req.url, null, {});
  const xpaths = certifiedXPaths(req.fields);
  const options: CaptureOptions = {
    waitUntil: 'load',
    interceptNetworkRequests: true,
    // The picker's selection, read into `capture.pageVariant` (spec 2026-10-14 §3).
    selection: buildSelectionScript(),
    ...(kind === 'lean'
      ? {
        ready: buildReadyCheck(req.fields, req.url, pageVariant, { preferFirstPathMs: LEAN_FIRST_PATH_MS }),
        // The certified XPaths in the live tab: no second render (spec 2026-10-23 run speed §3.1).
        finalProbe: buildXPathProbeScript(xpaths),
        lean: { expand: xpaths.length > 0 },
      }
      : { ready: buildReadyCheck(req.fields, req.url, pageVariant), ...(kind === 'full-no-pictures' ? { pictures: false } : {}) }),
  };
  const release = await (deps.acquireLock ?? acquireDomainLock)(host);
  try {
    const capture = await deps.browser.capture(req.url, options);
    // Feed the verdict back to the host's pacing (a challenge or refusal backs the next acquire off; an ok clears it).
    reportVerdict(host, capture.verdict);
    return capture;
  } finally {
    release();
  }
}
