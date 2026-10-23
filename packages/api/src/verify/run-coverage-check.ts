// packages/api/src/verify/run-coverage-check.ts
// The coverage check (spec 2026-10-10 §A): after a passing Verify, sample
// twenty products from the listing, run the certified paths on each, and
// record per page which fields came back empty, with the page's shape.
// Page loads and code only: no model, ever. Writes only its own
// `coverage_checks` row — no captures, no verification set, no path stats,
// no domain cache (spec A4). Follows run-drift-check.ts: fire-and-forget,
// never rejects, always leaves its row terminal.
import { and, desc, eq } from 'drizzle-orm';
import { db, coverageChecks, sources } from '@robot/db';
import { CaptureError, verdictSentence } from '@robot/browser';
import {
  backoffAnswer, CaptureProblemError, findProductGroup, readListingPage, reportVerdict, runVerifiedExtraction, shapeOf, urlShape,
  type SchemaDefinitionField, type Shape, type VerificationSet, type VerifiedField,
} from '@robot/scraper';
import { withBrowserSession } from '../browser-session.js';
import { safeErrorMessage } from '../crawl/plan-source.js';
import { loadCurrentCertification } from './current-certification.js';
import { loadProofPageCaptures } from './proof-page-capture.js';
import { sampleListing } from './coverage-sampler.js';
import { summariseCoverage, stageLine, COVERAGE_STALLED, type CoverageResults, type SampledPage, type FieldCoverage } from './coverage-summary.js';

/** A check is twenty page loads, three at a time at most — well inside ten minutes; an older `running` row is a crash leftover (the drift check's rule). */
export const COVERAGE_CHECK_STALL_MS = 10 * 60 * 1000;
/** Three refused/challenged pages in a row end the check with what it has (the run breaker's rule, fix wave C2 2026-10-09). */
export const COVERAGE_WALL_BREAKER = 3;
/** Three pages in a row failing for an unexpected reason (a missing Chromium, say) end the check with what it has, rather than twenty launches. */
export const COVERAGE_ERROR_BREAKER = 3;
/** What a page reads as when its read threw for a reason nothing above knows. */
export const PAGE_UNREADABLE = 'The page could not be read.';

export type CoverageDeps = {
  listing?: (url: string) => Promise<{ productUrls: string[]; verdictMessage: string | null }>;
  extract?: (url: string, fields: VerifiedField[]) => Promise<{ data: Record<string, unknown>; shape: Shape; defaulted?: string[] } | { unread: string; wall: boolean }>;
  proofShapes?: (sourceId: string, urls: string[]) => Promise<Record<string, Shape>>;
};

/**
 * The listing's products, read the way "Find products" reads them
 * (`readListingPage` + `findProductGroup`, spec 2026-10-20); a non-ok
 * verdict, or no document at all, is the sentence instead. A host still backing off is answered from the
 * backoff, with no browser.
 */
async function defaultListing(url: string): Promise<{ productUrls: string[]; verdictMessage: string | null }> {
  const waiting = backoffAnswer(url);
  if (waiting) return { productUrls: [], verdictMessage: waiting.message };
  const hostname = new URL(url).hostname;
  try {
    // The worker's browser gate keeps it within WORKER_BROWSERS, like every page the check reads (spec A3).
    return await withBrowserSession(async (browser) => {
      const { capture, links } = await readListingPage(browser, url, { load: true });
      reportVerdict(hostname, capture.verdict);
      if (capture.verdict.kind !== 'ok') return { productUrls: [], verdictMessage: verdictSentence(capture.verdict, url) };
      return { productUrls: findProductGroup(links, url)?.urls ?? [], verdictMessage: null };
    });
  } catch (err) {
    if (!(err instanceof CaptureError)) throw err;
    reportVerdict(hostname, err.kind);
    return { productUrls: [], verdictMessage: verdictSentence({ kind: err.kind }, url) };
  }
}

/**
 * A host still backing off after a wall answers for the page at once, as a
 * wall, with the backoff's sentence: no slot, no browser. Otherwise the
 * domain lock would sleep the backoff out (2, then 4 minutes) while holding a
 * capture slot and an idle browser, and the three-wall stop would take
 * minutes — past the stall rule.
 */
export function answerFromBackoff(url: string): { unread: string; wall: true } | null {
  const waiting = backoffAnswer(url);
  return waiting ? { unread: waiting.message, wall: true } : null;
}

/** One sampled page: certified paths only, within the worker's browser gate (WORKER_BROWSERS), under the domain lock `runVerifiedExtraction` takes itself. */
async function defaultExtract(url: string, fields: VerifiedField[]): ReturnType<NonNullable<CoverageDeps['extract']>> {
  const waiting = answerFromBackoff(url);
  if (waiting) return waiting;
  return withBrowserSession(async (browser) => {
    try {
      const r = await runVerifiedExtraction({ url, fields }, { browser });
      return { data: r.data, shape: shapeOf(r.capture!), defaulted: r.defaulted };
    } catch (err) {
      if (err instanceof CaptureProblemError) {
        const kind = err.verdict?.kind;
        return { unread: err.message, wall: kind === 'refused' || kind === 'challenge' };
      }
      if (err instanceof CaptureError) return { unread: err.message, wall: false };
      throw err;
    }
  });
}

/** The proof pages' shapes from their latest fresh captures (the ones the Verification tab's cards read); a url with none is left out. */
async function defaultProofShapes(sourceId: string, urls: string[]): Promise<Record<string, Shape>> {
  const records = await loadProofPageCaptures(sourceId, urls);
  return Object.fromEntries(Object.entries(records).map(([url, record]) => [url, shapeOf(record.capture)]));
}

/**
 * Start a coverage check for a website, or return the one already running for
 * the same Verify. A stalled one is closed `failed` / `'stalled'` first. One
 * running for an older Verify (a different `verificationId`, or none) is closed
 * `failed` / `'superseded'` and a new one starts: it read the previous
 * certification, and the tab shows the newest (spec 2026-10-10 §A1). Its own
 * final write is guarded to `running` rows, so it then lands nowhere.
 */
export async function startCoverageCheck(
  sourceId: string,
  verificationId: string | null,
  opts: { fire?: boolean } & CoverageDeps = {},
): Promise<{ checkId: string; status: 'started' | 'in-progress' }> {
  const running = await db.query.coverageChecks.findFirst({
    where: and(eq(coverageChecks.sourceId, sourceId), eq(coverageChecks.status, 'running')),
    orderBy: [desc(coverageChecks.createdAt)],
    columns: { id: true, createdAt: true, verificationId: true },
  });
  if (running) {
    const stalled = Date.now() - running.createdAt.getTime() >= COVERAGE_CHECK_STALL_MS;
    const superseded = verificationId !== null && running.verificationId !== verificationId;
    if (!stalled && !superseded) return { checkId: running.id, status: 'in-progress' };
    await db.update(coverageChecks)
      .set({ status: 'failed', error: stalled ? 'stalled' : 'superseded', completedAt: new Date() })
      .where(and(eq(coverageChecks.id, running.id), eq(coverageChecks.status, 'running')));
  }
  const [row] = await db.insert(coverageChecks).values({ sourceId, verificationId, status: 'running' }).returning({ id: coverageChecks.id });
  const checkId = row!.id;
  const { fire, ...deps } = opts;
  if (fire ?? true) void runCoverageCheck(checkId, deps);
  return { checkId, status: 'started' };
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '';

/** Never rejects: a throw anywhere leaves the row `failed` with its error. */
export async function runCoverageCheck(checkId: string, deps: CoverageDeps = {}): Promise<void> {
  const listing = deps.listing ?? defaultListing;
  const extract = deps.extract ?? defaultExtract;
  const proofShapes = deps.proofShapes ?? defaultProofShapes;
  try {
    const check = await db.query.coverageChecks.findFirst({ where: eq(coverageChecks.id, checkId) });
    if (!check) return;
    const source = await db.query.sources.findFirst({ where: eq(sources.id, check.sourceId), columns: { schemaDefinition: true, verificationSet: true } });
    if (!source) throw new Error(`Website ${check.sourceId} not found`);
    const set = (source.verificationSet ?? { urls: [], expected: {} }) as VerificationSet;
    const fieldsDef = (Array.isArray(source.schemaDefinition) ? source.schemaDefinition : []) as SchemaDefinitionField[];
    const cert = await loadCurrentCertification(db, check.sourceId);
    const done = async (results: CoverageResults) => {
      await db.update(coverageChecks).set({ status: 'done', results, completedAt: new Date() })
        .where(and(eq(coverageChecks.id, checkId), eq(coverageChecks.status, 'running')));
    };
    const listingUrl = set.listing_url;
    if (!listingUrl || !cert) { await done({ listingUrl: listingUrl ?? '', sampled: [], proofShapes: {} }); return; }

    const { productUrls, verdictMessage } = await listing(listingUrl);
    if (verdictMessage) throw new Error(verdictMessage);
    // Spec 2026-10-20 §3.6: a listing with no products is an answer — nothing is sampled, and the tab says so.
    if (productUrls.length === 0) { await done({ listingUrl, sampled: [], proofShapes: {}, planned: 0, noProducts: true }); return; }
    const urls = sampleListing(productUrls, set.urls);
    // Products, every one a proof page: nothing left to sample, and the tab says so (never silent).
    if (urls.length === 0) { await done({ listingUrl, sampled: [], proofShapes: {}, planned: 0, allProofPages: true }); return; }
    // The planned size, so the tab's running line can count before any page is read.
    await db.update(coverageChecks).set({ results: { listingUrl, sampled: [], proofShapes: {}, planned: urls.length } satisfies CoverageResults })
      .where(and(eq(coverageChecks.id, checkId), eq(coverageChecks.status, 'running')));

    const fields: VerifiedField[] = fieldsDef.filter((f) => (cert.paths[f.key]?.length ?? 0) > 0)
      .map((f) => ({
        key: f.key, type: f.type, concept: f.concept, paths: cert.paths[f.key]!,
        ...(cert.defaults?.[f.key] !== undefined ? { defaultValue: cert.defaults[f.key]! } : {}),
      }));
    const sampled: SampledPage[] = [];
    let walls = 0;
    let errors = 0;
    for (const url of urls) {
      try {
        const still = await db.query.coverageChecks.findFirst({ where: eq(coverageChecks.id, checkId), columns: { status: true } });
        if (still?.status !== 'running') {
          console.log(`[coverage] check ${checkId} no longer running (${still?.status ?? 'gone'}); stopping`);
          return;
        }
      } catch (err) {
        // A transient read failure never stops the check; it keeps going on what it already knows.
        console.error(`[coverage] check ${checkId}: status re-read failed, continuing:`, err);
      }
      let r: Awaited<ReturnType<typeof extract>>;
      try {
        r = await extract(url, fields);
      } catch (err) {
        // One page's unexpected failure is that page unread, never the check failed.
        console.error(`[coverage] check ${checkId}: reading ${url} failed:`, err);
        sampled.push({ url, unread: PAGE_UNREADABLE });
        walls = 0;
        if (++errors >= COVERAGE_ERROR_BREAKER) break;
        continue;
      }
      errors = 0;
      if ('unread' in r) {
        sampled.push({ url, unread: r.unread });
        walls = r.wall ? walls + 1 : 0;
        if (walls >= COVERAGE_WALL_BREAKER) break;
        continue;
      }
      walls = 0;
      sampled.push({ url, empty: fields.filter((f) => isEmpty(r.data[f.key]) || (r.defaulted ?? []).includes(f.key)).map((f) => f.key), shape: r.shape });
    }
    await done({ listingUrl, sampled, proofShapes: await proofShapes(check.sourceId, set.urls), planned: urls.length });
  } catch (err) {
    console.error(`[coverage] check ${checkId} failed:`, err);
    try {
      await db.update(coverageChecks)
        .set({ status: 'failed', error: safeErrorMessage(err).slice(0, 1000), completedAt: new Date() })
        .where(and(eq(coverageChecks.id, checkId), eq(coverageChecks.status, 'running')));
    } catch (recoveryErr) {
      console.error(`[coverage] failed to record failure for ${checkId}:`, recoveryErr);
    }
  }
}

export type LatestCoverageCheck = {
  id: string;
  status: 'running' | 'done' | 'failed';
  results: CoverageResults | null;
  error: string | null;
  createdAt: Date;
  fields: FieldCoverage[];
  stage: string | null;
};

/**
 * The newest check with its per-field summary and stage line. A stalled
 * `running` row is closed `failed` / `'stalled'` on the way (the drift
 * check's rule) and the next Verify tries again. A stalled check's stage is
 * `COVERAGE_STALLED` (spec 2026-10-20 §3.5.5); a superseded one's is null.
 */
export async function latestCoverageCheck(sourceId: string): Promise<LatestCoverageCheck | null> {
  let row = await db.query.coverageChecks.findFirst({ where: eq(coverageChecks.sourceId, sourceId), orderBy: [desc(coverageChecks.createdAt)] });
  if (!row) return null;
  if (row.status === 'running' && Date.now() - row.createdAt.getTime() >= COVERAGE_CHECK_STALL_MS) {
    const [closed] = await db.update(coverageChecks)
      .set({ status: 'failed', error: 'stalled', completedAt: new Date() })
      .where(and(eq(coverageChecks.id, row.id), eq(coverageChecks.status, 'running')))
      .returning();
    row = closed ?? (await db.query.coverageChecks.findFirst({ where: eq(coverageChecks.id, row.id) })) ?? row;
  }
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
  const keys = ((Array.isArray(source?.schemaDefinition) ? source!.schemaDefinition : []) as SchemaDefinitionField[]).map((f) => f.key);
  // Spec 2026-10-20 §3.8: per field, the address shapes of the proof pages answered "Not on this product" — read now, so an answer given after the check counts.
  const absent = ((source?.verificationSet ?? null) as VerificationSet | null)?.absent ?? {};
  const absentShapes = Object.fromEntries(Object.entries(absent).map(([key, cells]) => [key,
    Object.entries(cells).filter(([, on]) => on === true).map(([url]) => urlShape(url)).filter((s): s is string => s !== null)]));
  const results = (row.results as CoverageResults | null) ?? null;
  const status = row.status as 'running' | 'done' | 'failed';
  const fields: FieldCoverage[] = status === 'done' && results ? summariseCoverage(results, keys, absentShapes) : [];
  const answered = fields.filter((x) => x.answered).length;
  return {
    id: row.id, status, results, error: row.error, createdAt: row.createdAt, fields,
    stage: stageLine(status, results, fields.length - answered, row.error === 'superseded' ? null : row.error === 'stalled' ? COVERAGE_STALLED : row.error, answered),
  };
}
