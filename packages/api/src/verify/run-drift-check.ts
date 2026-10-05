// packages/api/src/verify/run-drift-check.ts
// The free drift check (plan 2026-10-05-drift-repair, Task 2): re-captures a
// website's proof pages and records, per drifted field, what happened to it —
// `classifyDrift`'s other-layout / moved / changed / lost, with page-gone per
// page. Page loads and code only: no agent is constructed and no model is
// called, ever.
//
// It changes nothing by itself. The only rows it writes are its own
// `drift_checks` row and the proof-page `captures` rows the capture function
// takes (the same captures the Verification tab takes). Never
// `verificationSet`, `schemaDefinition`, `driftedFields`,
// `source_verifications` or the domain cache — only a completed Verify does
// that.
//
// Follows run-source-verification.ts's fire-and-forget rule: the caller never
// awaits `runDriftCheck`, so it never rejects and always leaves the row
// terminal.
import { and, desc, eq } from 'drizzle-orm';
import { db, driftChecks, runs, sources } from '@robot/db';
import {
  buildDomSearchScript, buildXPathProbeScript, classifyDrift,
  type ConfirmedPath, type DomHit, type DomNeedle, type DriftCapture, type DriftCheckResults, type DriftFieldResult,
  type SchemaDefinitionField, type VerificationSet, type XPathProbeResult,
} from '@robot/scraper';
import { withBrowserSession } from '../browser-session.js';
import { safeErrorMessage } from '../crawl/plan-source.js';
import { runEmptyShares } from '../crawl/drift.js';
import { loadCurrentCertification } from './current-certification.js';
import { startProofPageCapture, runProofPageCaptureInSlot, loadProofPageCaptures, type ProofPageCaptureRecord } from './proof-page-capture.js';

type Session = typeof withBrowserSession;

/** Fresh captures of a website's proof pages, by url; `null` where the page could not be captured now (it redirects, 404s, or fails to load). */
export type CaptureProofPagesFn = (sourceId: string, urls: string[]) => Promise<Record<string, ProofPageCaptureRecord | null>>;

/**
 * A check is three captures at a time plus offline classification — well
 * inside ten minutes. A `running` row older than this is a crash leftover (an
 * api-server restart mid-check): it is closed as `failed` / `'stalled'` and a
 * new check may start (the stall rule Verify uses, in-flight.ts).
 */
export const DRIFT_CHECK_STALL_MS = 10 * 60 * 1000;

/**
 * The capture function behind a real check: a new proof-page capture row per
 * url, run here (awaited) rather than fired, in the proof-page captures' shared
 * three slots — the tab's captures and the check's together never exceed three browsers. Only the capture
 * this call took counts — `loadProofPageCaptures` returns the newest
 * *successful* capture per url, so a page that fails now would otherwise be
 * answered by an older capture that worked, and a gone page would read as
 * still there.
 */
export function captureProofPagesWith(session: Session = withBrowserSession): CaptureProofPagesFn {
  return async (sourceId, urls) => {
    const taken = await Promise.all(urls.map(async (url) => {
      const { captureId } = await startProofPageCapture(sourceId, url, { fire: false });
      await runProofPageCaptureInSlot(captureId, session);
      return [url, captureId] as const;
    }));
    const loaded = await loadProofPageCaptures(sourceId, urls);
    return Object.fromEntries(taken.map(([url, id]) => [url, loaded[url]?.ref.captureId === id ? loaded[url]! : null]));
  };
}

export const defaultCaptureProofPages: CaptureProofPagesFn = captureProofPagesWith();

/**
 * Start a drift check for a website, or return the one already running.
 * Org-scoped through its callers (`sources.checkDrift`, and `startExecution`
 * on a run it owns).
 *
 * `emptyShare` (each drifted field's empty share in the run, from
 * `flagDrift`) is written into the row's results up front, so the banner can
 * say "% of products empty" whatever the check finds.
 */
export async function startDriftCheck(
  sourceId: string,
  runId: string | null,
  opts: { capture?: CaptureProofPagesFn; fire?: boolean; emptyShare?: Record<string, number> } = {},
): Promise<{ checkId: string; status: 'started' | 'in-progress' }> {
  const running = await db.query.driftChecks.findFirst({
    where: and(eq(driftChecks.sourceId, sourceId), eq(driftChecks.status, 'running')),
    orderBy: [desc(driftChecks.createdAt)],
    columns: { id: true, createdAt: true },
  });
  if (running) {
    if (Date.now() - running.createdAt.getTime() < DRIFT_CHECK_STALL_MS) return { checkId: running.id, status: 'in-progress' };
    await db.update(driftChecks)
      .set({ status: 'failed', error: 'stalled', completedAt: new Date() })
      .where(and(eq(driftChecks.id, running.id), eq(driftChecks.status, 'running')));
  }

  const upFront = Object.fromEntries(Object.entries(opts.emptyShare ?? {}).map(([key, share]) => [key, { key, emptyShare: share }]));
  const [row] = await db.insert(driftChecks)
    .values({ sourceId, runId, status: 'running', results: { runId, fields: upFront } })
    .returning({ id: driftChecks.id });
  const checkId = row!.id;
  if (opts.fire ?? true) void runDriftCheck(checkId, { capture: opts.capture });
  return { checkId, status: 'started' };
}

/** The distinct paths the customer confirmed for a field, across its pages (run-verification.ts's `confirmedPathsOf`). */
function confirmedPathsOf(set: VerificationSet, key: string): ConfirmedPath[] {
  const all = Object.values(set.paths?.[key] ?? {});
  return all.filter((p, i) => all.findIndex((q) => q.source === p.source && q.path === p.path) === i).map((p) => ({ source: p.source, path: p.path }));
}

/** Never rejects: a throw anywhere leaves the row `failed` with its error. */
export async function runDriftCheck(checkId: string, deps: { capture?: CaptureProofPagesFn; session?: Session } = {}): Promise<void> {
  const capture = deps.capture ?? defaultCaptureProofPages;
  const session = deps.session ?? withBrowserSession;
  try {
    const check = await db.query.driftChecks.findFirst({ where: eq(driftChecks.id, checkId) });
    if (!check) return;
    const source = await db.query.sources.findFirst({
      where: eq(sources.id, check.sourceId),
      columns: { schemaDefinition: true, verificationSet: true, driftedFields: true },
    });
    if (!source) throw new Error(`Website ${check.sourceId} not found`);
    const fields = (Array.isArray(source.schemaDefinition) ? source.schemaDefinition : []) as SchemaDefinitionField[];
    const set = (source.verificationSet ?? { urls: [], expected: {} }) as VerificationSet;
    const drifted = (Array.isArray(source.driftedFields) ? source.driftedFields : []) as string[];
    const driftedFields = drifted.map((k) => fields.find((f) => f.key === k)).filter((f): f is SchemaDefinitionField => !!f);
    const cert = await loadCurrentCertification(db, check.sourceId);

    const out: Record<string, DriftFieldResult> = {};
    // A field with no current certified path has nothing to re-read: lost, with no work.
    // (No proof pages at all is the same: nothing to re-read.)
    const toClassify = set.urls.length === 0 ? [] : driftedFields.filter((f) => (cert?.paths[f.key]?.length ?? 0) > 0);
    for (const f of driftedFields) if (!toClassify.includes(f)) out[f.key] = { key: f.key, result: 'lost', pages: {} };

    if (toClassify.length > 0) {
      const records = await capture(check.sourceId, set.urls);
      const captures: Record<string, DriftCapture | null> = Object.fromEntries(set.urls.map((u) => {
        const r = records[u];
        return [u, r ? { ...r.capture, boxes: r.meta.boxes } : null];
      }));
      await session(async (browser) => {
        const classifyDeps = {
          evalXPaths: (html: string, xpaths: string[]) => browser.setContentEvaluate<XPathProbeResult>(html, buildXPathProbeScript(xpaths)),
          runDomSearch: (html: string, needles: DomNeedle[], pageUrl: string) => browser.setContentEvaluate<DomHit[]>(html, buildDomSearchScript(needles, pageUrl)),
        };
        for (const field of toClassify) {
          out[field.key] = await classifyDrift({
            field,
            expected: set.expected[field.key] ?? {},
            certified: cert!.paths[field.key]!,
            captures,
            confirmed: confirmedPathsOf(set, field.key),
            markXPaths: Object.values(set.marks?.[field.key] ?? {}).flatMap((m) => m.xpaths),
          }, classifyDeps);
        }
      });
    }

    // Each field's empty share in the run: as handed over at the start, else read from the run itself (a check started on demand).
    const upFront = ((check.results as DriftCheckResults | null)?.fields ?? {}) as Record<string, Partial<DriftFieldResult>>;
    const missing = Object.keys(out).filter((k) => typeof upFront[k]?.emptyShare !== 'number');
    const fromRun = check.runId && missing.length > 0 ? await runEmptyShares(db, check.runId, missing) : {};
    for (const key of Object.keys(out)) {
      const share = upFront[key]?.emptyShare ?? fromRun[key];
      if (typeof share === 'number') out[key] = { ...out[key]!, emptyShare: share };
    }

    const results: DriftCheckResults = { runId: check.runId, fields: out };
    await db.update(driftChecks)
      .set({ status: 'done', results, completedAt: new Date() })
      .where(and(eq(driftChecks.id, checkId), eq(driftChecks.status, 'running')));
  } catch (err) {
    console.error(`[drift] check ${checkId} failed:`, err);
    try {
      await db.update(driftChecks)
        .set({ status: 'failed', error: safeErrorMessage(err).slice(0, 1000), completedAt: new Date() })
        .where(and(eq(driftChecks.id, checkId), eq(driftChecks.status, 'running')));
    } catch (recoveryErr) {
      console.error(`[drift] failed to record failure for ${checkId}:`, recoveryErr);
    }
  }
}

/** The latest drift check for a website, with the date of the run it is about (null when none). */
export async function latestDriftCheck(sourceId: string) {
  const row = await db.query.driftChecks.findFirst({
    where: eq(driftChecks.sourceId, sourceId),
    orderBy: [desc(driftChecks.createdAt)],
  });
  if (!row) return null;
  const run = row.runId ? await db.query.runs.findFirst({ where: eq(runs.id, row.runId), columns: { completedAt: true } }) : null;
  // While running, the row's results hold only the up-front shares (`{ key, emptyShare }` per field) — not a
  // DriftCheckResults — so `results` is null until done, and the shares are handed out on their own.
  const fields = ((row.results as { fields?: Record<string, { emptyShare?: number }> } | null)?.fields ?? {});
  const emptyShare = Object.fromEntries(Object.entries(fields).filter(([, f]) => typeof f.emptyShare === 'number').map(([k, f]) => [k, f.emptyShare!]));
  return {
    id: row.id,
    status: row.status as 'running' | 'done' | 'failed',
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    results: row.status === 'done' ? (row.results as DriftCheckResults) : null,
    runAt: run?.completedAt ?? null,
    /** Each drifted field's empty share in that run, by key — available while the check is still running. */
    emptyShare,
  };
}

/** The run a check started on demand is about: the website's latest run that flagged drift, or null. */
export async function latestDriftedRun(sourceId: string): Promise<string | null> {
  const recent = await db.query.runs.findMany({
    where: eq(runs.sourceId, sourceId),
    orderBy: [desc(runs.createdAt)],
    columns: { id: true, driftedFields: true },
    limit: 20,
  });
  return recent.find((r) => Array.isArray(r.driftedFields) && r.driftedFields.length > 0)?.id ?? null;
}
