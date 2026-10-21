// packages/api/src/verify/run-drift-check.ts
// The free drift check (plan 2026-10-05-drift-repair, Task 2): re-captures a
// website's proof pages and records, per drifted field, what happened to it —
// `classifyDrift`'s other-layout / moved / changed / lost / not-checked, with
// page-gone or not-checked per page it could not use. Page loads and code only: no agent is constructed and no model is
// called, ever.
//
// It writes its own `drift_checks` row, the proof-page `captures` rows the
// capture function takes (the same captures the Verification tab takes) and
// the website's `next_check_at`. One exception changes the website (spec
// 2026-10-21 §3.2): a field that changes by nature and passes the refresh rule
// (`planRefresh`) gets its new expected values, a hold and a `value_refreshes`
// row (refresh-values.ts), and a free re-verify of it starts. Never
// `schemaDefinition`, `driftedFields`, marks or the domain cache.
//
// Follows run-source-verification.ts's fire-and-forget rule: the caller never
// awaits `runDriftCheck`, so it never rejects and always leaves the row
// terminal.
import { and, desc, eq } from 'drizzle-orm';
import { db, captures as captureRows, driftChecks, runs, sources } from '@robot/db';
import {
  buildDomSearchScript, buildXPathProbeScript, classifyDrift, fieldHash, markPaths, planRefresh,
  type Box, type CertifiedPath, type ConfirmedPath, type DomHit, type DomNeedle, type DriftCapture, type DriftCheckResults, type DriftFieldResult,
  type DriftTrigger, type PathReading, type SchemaDefinitionField, type VerificationSet, type XPathProbeResult,
} from '@robot/scraper';
import type { PageCapture } from '@robot/browser';
import { withBrowserSession } from '../browser-session.js';
import { safeErrorMessage } from '../crawl/plan-source.js';
import { runEmptyShares } from '../crawl/drift.js';
import { certifyingResult, loadFieldCurrency } from './current-certification.js';
import { applyRefreshes, startRefreshVerify, type RefreshRequest } from './refresh-values.js';
import { startProofPageCapture, runProofPageCaptureInSlot, loadProofPageCaptureById, type ProofPageMeta } from './proof-page-capture.js';
import { readCaptureFile, type StoredCaptureRef } from './capture-store.js';
import { readingsOf } from './holds.js';
import { nextCheckAt } from './check-schedule.js';

type Session = typeof withBrowserSession;

/**
 * Fresh captures of a website's proof pages, by url: the record when the page
 * was captured; `{ notChecked }` (the verdict sentence) when the page exists
 * but could not be read now — the site refused or challenged the browser,
 * answered blank, timed out, crashed, or the host is backing off; `null` when
 * the page is gone (it 404s, redirects off-site, or left no record).
 */
export type CaptureProofPagesFn = (sourceId: string, urls: string[]) => Promise<Record<string, CheckedPage | { notChecked: string } | null>>;

/** A captured page the check reads: a proof-page capture record, or a stored Verify capture (no box map). */
export type CheckedPage = { ref: StoredCaptureRef; capture: PageCapture; meta?: { boxes?: Box[] } };

/**
 * Spec 2026-10-21 §3.3 (`verify` trigger): the pages a Verify just read, from the files it stored — no
 * page load, no Jev reading. A page that Verify could not read is not checked, with its reason.
 */
export function storedCaptures(refs: Record<string, StoredCaptureRef>): CaptureProofPagesFn {
  return async (_sourceId, urls) => Object.fromEntries(await Promise.all(urls.map(async (url) => {
    const ref = refs[url];
    if (!ref || !ref.captureId) return [url, { notChecked: ref?.blockedReason ?? 'The page could not be read.' }] as const;
    const capture = await readCaptureFile(ref.captureId);
    return [url, capture ? { ref, capture } : { notChecked: 'The page could not be read.' }] as const;
  })));
}

/**
 * What a failed proof-page capture means to the drift check (known-gaps fixes
 * 2026-10-11, Task 2): `not-found` and `redirected` say the page is gone
 * (`null`), and so does a same-host landing on another path — `captureProblem`'s
 * verdict-less "redirected to …" (a removed product sent to its category page).
 * Every other verdict (refused, challenge, blank, timeout, unreachable,
 * crashed), and any other failure with no verdict, says only that we could not
 * read it now, with the stored error (since 2026-10-09 the verdict sentence; a
 * backoff answer adds the wait) as the reason.
 */
export function outcomeOfFailedCapture(meta: { error: string; verdict?: { kind: string } }): null | { notChecked: string } {
  const kind = meta.verdict?.kind;
  if (kind === 'not-found' || kind === 'redirected') return null;
  if (!kind && meta.error.startsWith('redirected to ')) return null;
  return { notChecked: meta.error };
}

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
 * this call took counts, read back by its own capture id: a page that fails
 * now must not be answered by an older capture that worked (a gone page would
 * read as still there), and a tab capture of the same url finishing later
 * must not turn ours into a false page-gone (final review M3).
 */
export function captureProofPagesWith(session: Session = withBrowserSession): CaptureProofPagesFn {
  return async (sourceId, urls) => {
    const taken = await Promise.all(urls.map(async (url) => {
      const { captureId } = await startProofPageCapture(sourceId, url, { fire: false });
      // Never a Jev reading: a drift re-capture is not a page the customer is verifying, and a reading is paid.
      await runProofPageCaptureInSlot(captureId, session, { jev: false });
      const row = await db.query.captures.findFirst({ where: eq(captureRows.id, captureId), columns: { metadata: true } });
      const meta = row?.metadata as ProofPageMeta | null | undefined;
      if (meta?.status === 'failed') return [url, outcomeOfFailedCapture(meta)] as const;
      // The slot resolved but the row is still `capturing`: its own failure
      // write failed too. Without this, `loadProofPageCaptureById` reads no
      // captured row and returns null — a false "page gone" (final review
      // Minor 4), the one route to it left after `outcomeOfFailedCapture`.
      if (meta?.status === 'capturing') return [url, { notChecked: 'The page could not be read.' }] as const;
      return [url, await loadProofPageCaptureById(captureId)] as const;
    }));
    return Object.fromEntries(taken);
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
  opts: { capture?: CaptureProofPagesFn; fire?: boolean; emptyShare?: Record<string, number>; trigger?: DriftTrigger; keys?: string[] } = {},
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
    .values({ sourceId, runId, status: 'running', trigger: opts.trigger ?? 'run', results: { runId, fields: upFront, ...(opts.keys ? { keys: opts.keys } : {}) } })
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

/**
 * Plans each classified field's refresh from what its certified paths read now (`planRefresh`), applies the
 * planned ones, and fills each field's `refresh` in `out`. Returns the keys refreshed. A failure to apply
 * never fails the check: those fields read `not-applied`.
 */
async function refreshByNature(
  checkId: string,
  sourceId: string,
  toClassify: SchemaDefinitionField[],
  set: VerificationSet,
  readingsByKey: Record<string, Record<string, PathReading>>,
  out: Record<string, DriftFieldResult>,
  apply: typeof applyRefreshes,
): Promise<string[]> {
  if (toClassify.length === 0) return [];
  const currency = await loadFieldCurrency(db, sourceId);
  const requests: RefreshRequest[] = [];
  for (const field of toClassify) {
    const certifying = certifyingResult(currency, field.key);
    const readings = readingsByKey[field.key];
    if (!certifying || !readings) continue;
    const provenOn = Object.fromEntries(Object.entries(certifying.result.cells).map(([u, c]) => [u, c.status === 'pass' ? c.path : undefined]));
    const plan = planRefresh({ field, expected: set.expected[field.key] ?? {}, provenOn, readings });
    if (plan.kind === 'refresh') requests.push({ key: field.key, pages: plan.pages, basisHash: fieldHash(field, set) });
    else if (plan.kind === 'refused' && plan.reason !== 'not-by-nature') out[field.key] = { ...out[field.key]!, refresh: { applied: false, reason: plan.reason } };
  }
  if (requests.length === 0) return [];
  try {
    const outcome = await apply(sourceId, checkId, requests);
    for (const r of requests) {
      out[r.key] = { ...out[r.key]!, refresh: outcome.applied.includes(r.key) ? { applied: true } : { applied: false, reason: outcome.skipped[r.key] ?? 'busy' } };
    }
    return outcome.applied;
  } catch (err) {
    console.error(`[drift] check ${checkId}: refreshing failed:`, err);
    for (const r of requests) out[r.key] = { ...out[r.key]!, refresh: { applied: false, reason: 'not-applied' } };
    return [];
  }
}

/** Never rejects: a throw anywhere leaves the row `failed` with its error. */
export async function runDriftCheck(
  checkId: string,
  deps: { capture?: CaptureProofPagesFn; session?: Session; applyRefreshes?: typeof applyRefreshes; startRefreshVerify?: typeof startRefreshVerify } = {},
): Promise<void> {
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
    // Spec 2026-10-21 §3.3: a check started with `keys` reads those fields; otherwise the drifted ones (today's rule).
    const upKeys = (check.results as { keys?: string[] } | null)?.keys;
    const trigger = (check.trigger ?? 'run') as DriftTrigger;
    const wanted = upKeys ?? drifted;
    const driftedFields = wanted.map((k) => fields.find((f) => f.key === k)).filter((f): f is SchemaDefinitionField => !!f);
    // Final review I2: each field's own certifying paths — its current result, else its hold — never the
    // all-or-nothing website certification, which is null when any one field is neither current nor held.
    const currency = await loadFieldCurrency(db, check.sourceId);
    const pathsOf: Record<string, CertifiedPath[]> = Object.fromEntries(
      driftedFields.map((f) => [f.key, certifyingResult(currency, f.key)?.result.certified ?? []]),
    );
    const defaultKeys = Object.entries(set.defaults ?? {}).filter(([, d]) => (d ?? '').trim() !== '').map(([k]) => k);

    const out: Record<string, DriftFieldResult> = {};
    // A field with no certifying path has nothing to re-read. A run's drift (and a customer's check of it)
    // says lost; a verify or scheduled check was not asked about a lost field, so it records nothing for it.
    // (No proof pages at all is the same: nothing to re-read.)
    const toClassify = set.urls.length === 0 ? [] : driftedFields.filter((f) => pathsOf[f.key]!.length > 0);
    const recordsLost = trigger === 'run' || trigger === 'manual';
    // Follow-ups §3: a field passed by its default alone has no path by design — every product gets the default,
    // so it still works; it is never "lost" for having nothing to re-read.
    const byDefault = (f: SchemaDefinitionField) => certifyingResult(currency, f.key)?.result.defaultOnly === true && defaultKeys.includes(f.key);
    if (recordsLost) {
      for (const f of driftedFields) {
        if (!toClassify.includes(f)) out[f.key] = { key: f.key, result: byDefault(f) ? 'other-layout' : 'lost', pages: {} };
      }
    }

    const refs: Record<string, StoredCaptureRef> = {};
    // What a run writes per field and page; Task 6's refresh reads it.
    const readingsByKey: Record<string, Record<string, PathReading>> = {};
    if (toClassify.length > 0) {
      const records = await capture(check.sourceId, set.urls);
      // Three kinds of page: captured (decides), gone (null), and not checked —
      // the site would not let us read it now, so it neither decides nor is gone.
      const captures: Record<string, DriftCapture | null> = {};
      const notChecked: Record<string, string> = {};
      for (const u of set.urls) {
        const r = records[u];
        if (r && 'notChecked' in r) notChecked[u] = r.notChecked;
        else if (r) { captures[u] = { ...r.capture, boxes: r.meta?.boxes }; refs[u] = r.ref; }
        else captures[u] = null;
      }
      const pageCaptures: Record<string, PageCapture> = {};
      for (const u of set.urls) { const r = records[u]; if (r && !('notChecked' in r)) pageCaptures[u] = r.capture; }
      await session(async (browser) => {
        const classifyDeps = {
          evalXPaths: (html: string, xpaths: string[]) => browser.setContentEvaluate<XPathProbeResult>(html, buildXPathProbeScript(xpaths)),
          runDomSearch: (html: string, needles: DomNeedle[], pageUrl: string) => browser.setContentEvaluate<DomHit[]>(html, buildDomSearchScript(needles, pageUrl)),
        };
        for (const field of toClassify) {
          out[field.key] = await classifyDrift({
            field,
            expected: set.expected[field.key] ?? {},
            certified: pathsOf[field.key]!,
            captures,
            notChecked,
            confirmed: confirmedPathsOf(set, field.key),
            markXPaths: Object.values(set.marks?.[field.key] ?? {}).flatMap((m) => markPaths(field, m)),
            // Follow-ups §3: with nothing expected on any page, the field is judged by what a run writes, default included.
            defaultValue: set.defaults?.[field.key],
          }, classifyDeps);
          // What a run writes on each captured page (spec 2026-10-21 §3.3): the hold rule and the refresh read it.
          const readings = await readingsOf(browser, field, pathsOf[field.key]!, pageCaptures);
          readingsByKey[field.key] = readings;
          out[field.key] = { ...out[field.key]!, reads: Object.fromEntries(Object.entries(readings).map(([u, r]) => [u, r.value])) };
        }
      });
    }

    // Each field's empty share in the run: as handed over at the start, else read from the run itself (a check started on demand).
    const upFront = ((check.results as DriftCheckResults | null)?.fields ?? {}) as Record<string, Partial<DriftFieldResult>>;
    const missing = Object.keys(out).filter((k) => typeof upFront[k]?.emptyShare !== 'number');
    const fromRun = check.runId && missing.length > 0 ? await runEmptyShares(db, check.runId, missing, defaultKeys) : {};
    for (const key of Object.keys(out)) {
      const share = upFront[key]?.emptyShare ?? fromRun[key];
      if (typeof share === 'number') out[key] = { ...out[key]!, emptyShare: share };
    }

    // Spec 2026-10-21 §3.2: refresh what changed by nature, all or nothing per field. A field that is not
    // by nature records nothing; a refusal's reason code is staff-only.
    const refreshed = await refreshByNature(checkId, check.sourceId, toClassify, set, readingsByKey, out, deps.applyRefreshes ?? applyRefreshes);

    const results: DriftCheckResults = { runId: check.runId, fields: out, trigger, ...(upKeys ? { keys: upKeys } : {}), captures: refs };
    const [finished] = await db.update(driftChecks)
      .set({ status: 'done', results, completedAt: new Date() })
      .where(and(eq(driftChecks.id, checkId), eq(driftChecks.status, 'running')))
      .returning({ id: driftChecks.id });
    // Fix wave 1, item 7: closed as stalled between its refreshes' commit and here. The refreshes stand, so the
    // check is reopened as done, to show them (a check closed before they were written writes none).
    if (!finished && refreshed.length > 0) {
      await db.update(driftChecks).set({ status: 'done', error: null, results, completedAt: new Date() }).where(eq(driftChecks.id, checkId));
    }
    // The pages were just read: the scheduled check need not read them again for a while (spec §3.3).
    await db.update(sources).set({ nextCheckAt: nextCheckAt() }).where(eq(sources.id, check.sourceId));
    // The refreshed fields are verified again, free, on the pages this check just read. That re-verify is
    // refresh-origin, so it never starts another check (spec §7.6).
    // It names itself in this check's refresh log as it starts (review Minor 1).
    if (refreshed.length > 0) await (deps.startRefreshVerify ?? startRefreshVerify)(check.sourceId, refreshed, refs, { checkId });
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

/**
 * The latest drift check for a website, with the date of the run it is about (null when none).
 * A `running` row older than `DRIFT_CHECK_STALL_MS` is a crash leftover: it is closed as
 * `failed` / `'stalled'` on the way, so the tab stops showing "Checking what changed…"
 * forever (final review I2; `resolveStalledProofPage`'s rule).
 */
export async function latestDriftCheck(sourceId: string) {
  let row = await db.query.driftChecks.findFirst({
    where: eq(driftChecks.sourceId, sourceId),
    orderBy: [desc(driftChecks.createdAt)],
  });
  if (!row) return null;
  if (row.status === 'running' && Date.now() - row.createdAt.getTime() >= DRIFT_CHECK_STALL_MS) {
    const [closed] = await db.update(driftChecks)
      .set({ status: 'failed', error: 'stalled', completedAt: new Date() })
      .where(and(eq(driftChecks.id, row.id), eq(driftChecks.status, 'running')))
      .returning();
    row = closed ?? (await db.query.driftChecks.findFirst({ where: eq(driftChecks.id, row.id) })) ?? row;
  }
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
