// The body behind `sources.verify` (task 12): the body of the `verify` job
// (jobs/handlers/verify.ts); never awaited by a request. Follows
// `startExecution`'s try/catch-everything shape (crawl/start-execution.ts):
// it must never reject, and every failure path must still leave the row
// terminal (`completedAt` set). A row closed meanwhile (the runner stopped
// this attempt as stuck) is never written by it again (spec 2026-10-23 §7.6).

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PageCapture } from '@robot/browser';
import { BROWSER_UNAVAILABLE } from '@robot/browser';
import { SchemaAgent, withUsageScope, cappedAgent, openCapLedger, type CapLedger, type ProposePathsAgent, type UsageByModel, type UsageScope } from '@robot/agent';
import {
  runVerification,
  CaptureProblemError,
  saveVerifiedPaths,
  lookupVerifiedPaths,
  estAiCostPerFieldUsd,
  type SchemaDefinitionField,
  type VerificationSet,
  type VerificationOutcome,
  type CertifiedPath,
  type VariantVerification,
} from '@robot/scraper';
import type { VariantSetup } from '../contract.js';
import { variantsRequired, runVariantCheck, currentVariantHash, VARIANT_CHECK_FAILED } from './variant-check.js';
import { db, sources, sourceVerifications, captures } from '@robot/db';
import type { Database } from '@robot/db';
import { withBrowserSession } from '../browser-session.js';
import { persistScreenshot } from '../persist-screenshot.js';
import { safeErrorMessage } from '../crawl/plan-source.js';
import { loadStoredCapture, readCaptureFile, writeCaptureFile, type StoredCaptureRef } from './capture-store.js';
import { loadProofPageCaptures } from './proof-page-capture.js';
import { startCoverageCheck } from './run-coverage-check.js';
import { recordJevAgreement } from './jev-agreement.js';
import { certifyingResult, loadFieldCurrency } from './current-certification.js';
import { decideHolds, writeHolds, type HoldPlan } from './holds.js';
import { nextCheckAt } from './check-schedule.js';
import { jobStopped } from '../jobs/context.js';
import { syncAttentionSafely } from '../email/attention-sync.js';
import { orgCapState, type CapState } from '../metering/cap-state.js';
import { orgIdForSource } from '../export/org-for-export.js';

/**
 * Strips ANSI escape codes (e.g. the dim/reset styling Playwright's own
 * "Call log:" output carries in a timeout error) so a persisted
 * `errorMessage` renders as plain text instead of garbled glyphs in the
 * dashboard's error banner.
 */
function stripAnsi(message: string): string {
  return message.replace(new RegExp('\u001b\[[0-9;]*m', 'g'), '');
}

async function storeCapture(sourceId: string, url: string, c: PageCapture): Promise<StoredCaptureRef> {
  const shot = c.screenshot.length > 0 ? await persistScreenshot(c.screenshot) : null;
  const [row] = await db.insert(captures).values({
    sourceId,
    url,
    html: c.html,
    screenshotPath: shot?.url ?? null,
    metadata: { kind: 'verification' },
  }).returning({ id: captures.id });
  await writeCaptureFile(row!.id, c);
  return { captureId: row!.id, capturedAt: new Date().toISOString(), ...(shot ? { screenshotUrl: shot.url } : {}) };
}

/**
 * Write the current progress stage into the reserved _stage key of
 * sourceVerifications.captures — called un-awaited from onProgress
 * (fire-and-forget: it must never delay or fail the verification itself).
 *
 * Fix round 1 (Important defect): guarded with a completed_at IS NULL
 * condition. A stage write is fired synchronously from inside
 * runVerification and never awaited, so one can still be in flight when the
 * final results/captures/completedAt update lands. Without this guard, that
 * race lets a late stage write land AFTER completion and clobber the real
 * capture refs with { _stage: '...' }, corrupting an already-completed row.
 * Scoping the WHERE to an uncompleted row makes a late write a silent,
 * harmless no-op instead.
 */
export async function writeStage(dbOrTx: Database, verificationId: string, stage: string): Promise<void> {
  await dbOrTx
    .update(sourceVerifications)
    .set({ captures: { _stage: stage } })
    .where(and(eq(sourceVerifications.id, verificationId), isNull(sourceVerifications.completedAt)));
}

/** A refresh's re-verify loads no page (final review M1): a page with no stored capture is not read, with this sentence. */
const notLoadedNow = async (): Promise<PageCapture> => { throw new CaptureProblemError('The page could not be read.'); };

/** Starts the check that follows a Verify which left fields held (spec 2026-10-21 §3.3, trigger `verify`). */
export type StartVerifyCheck = (sourceId: string, keys: string[], refs: Record<string, StoredCaptureRef>) => Promise<unknown>;

/**
 * The `verify` check reads the Verify's own stored captures (no page load) and calls no model. It never
 * starts a Verify or another check, so it cannot loop back here.
 */
const startVerifyCheck: StartVerifyCheck = async (sourceId, keys, refs) => {
  // Imported when needed: the refresh (spec §3.2) makes run-drift-check reach this module, so a static import would be a cycle.
  const { startDriftCheck } = await import('./run-drift-check.js');
  // Enqueued with the stored refs (spec 2026-10-23 §4.4): the worker's job reads the same files.
  return startDriftCheck(sourceId, null, { trigger: 'verify', keys, storedRefs: refs });
};

/** At the monthly limit no model is built: the capped wrapper refuses every call before this is ever reached. */
const NO_MODEL: ProposePathsAgent = { proposePaths: async () => { throw new Error('no model at the monthly limit'); } };

/**
 * Review I2: a failed, stopped or closed-meanwhile attempt still spent what its model calls cost — added to its row
 * (open or closed; only `cost_usd`, which metering reads), measured the way a passing Verify measures it: this
 * attempt's own usage scope since the attempt began. Never throws.
 */
async function recordSpend(verificationId: string, usage: UsageScope, before: UsageByModel): Promise<void> {
  const usd = usage.costUsd(before);
  if (!(usd > 0)) return;
  try {
    await db.update(sourceVerifications)
      .set({ costUsd: sql`${sourceVerifications.costUsd} + ${usd.toFixed(4)}::numeric` })
      .where(eq(sourceVerifications.id, verificationId));
  } catch (err) {
    console.error(`[verify] failed to record the cost of ${verificationId}:`, err);
  }
}

type VerifyOpts = {
  onlyKeys?: string[];
  free?: boolean;
  startCoverage?: typeof startCoverageCheck;
  /** Spec 2026-10-21 §3.2: captures to verify on, used before any other (a check's own, for a refresh's re-verify). */
  captureRefs?: Record<string, StoredCaptureRef>;
  /** `refresh`: started by an automatic refresh — it never starts a check, so refreshes cannot loop (spec §7.6). */
  origin?: 'customer' | 'refresh';
  startCheck?: StartVerifyCheck;
};

/** Final review I2: a Verify's cost is what ITS model calls cost — its own usage scope, never the process-wide
 *  counter, which also holds every other job running in the worker at the same time (another org's among them). */
export function runSourceVerification(sourceId: string, verificationId: string, opts: VerifyOpts = {}): Promise<void> {
  return withUsageScope((usage) => runSourceVerificationIn(usage, sourceId, verificationId, opts));
}

async function runSourceVerificationIn(usage: UsageScope, sourceId: string, verificationId: string, opts: VerifyOpts): Promise<void> {
  const startCoverage = opts.startCoverage ?? startCoverageCheck;
  const startCheck = opts.startCheck ?? startVerifyCheck;
  let ledger: CapLedger | undefined;
  // Review I2: what this attempt's model calls cost is recorded on every exit (a pass, a failure, a stop), before its
  // slot is released — the org's next job reads it from the database. `costRecorded` once the result write added it.
  let before: UsageByModel | undefined;
  let costRecorded = false;
  try {
    const source = await db.query.sources.findFirst({
      where: eq(sources.id, sourceId),
      columns: { id: true, schemaDefinition: true, verificationSet: true, variantSetup: true },
      with: { dataset: { columns: { schema: true, variantMode: true } } },
    });
    if (!source) throw new Error(`Source ${sourceId} not found`);
    const fields = source.schemaDefinition as SchemaDefinitionField[];
    const set = source.verificationSet as VerificationSet;
    const variantSetup = (source.variantSetup as VariantSetup | null) ?? null;
    const checkVariants = variantsRequired(source.dataset?.variantMode, variantSetup) === 'yes';
    const hostname = new URL(set.urls[0]!).hostname;
    // Spec 2026-10-21 §3.1: what certified each field before this Verify — the hold rule compares against it.
    const certifiedBefore = await loadFieldCurrency(db, sourceId);

    // Re-verify only: reuse the previous completed run's captures when young
    // enough. The row being filled in is the newest, so look past it — and
    // past any failed/stalled row too (fix round 1, minor): a row closed out
    // with errorMessage set (a stall, or a genuine failure) never got as far
    // as writing real results/captures, so it must be skipped in favour of
    // the newest run that actually completed cleanly.
    const refresh = opts.origin === 'refresh';
    const reuse: Record<string, PageCapture> = {};
    const reusedRefs = new Map<string, StoredCaptureRef>();
    let previous: VerificationOutcome | undefined;
    // Final review I1: a refresh's re-verify re-checks the refreshed fields on the check's captures, never the
    // variants — it carries the last clean run's variant result forward, so it can never revoke them.
    let previousVariants: VariantVerification | null = null;
    for (const [url, ref] of Object.entries(opts.captureRefs ?? {})) {
      if (!ref.captureId || !set.urls.includes(url)) continue;
      const c = await readCaptureFile(ref.captureId);
      if (c) { reuse[url] = c; reusedRefs.set(url, ref); }
    }
    if (opts.onlyKeys || refresh) {
      const rows = await db.query.sourceVerifications.findMany({
        where: eq(sourceVerifications.sourceId, sourceId),
        orderBy: (t, { desc }) => [desc(t.startedAt)],
        limit: 5,
      });
      const last = rows.find((r) => r.id !== verificationId && r.completedAt !== null && r.errorMessage === null);
      if (last) {
        if (opts.onlyKeys) previous = { fields: last.results as VerificationOutcome['fields'], allPassed: last.allPassed, aiCalls: last.aiCalls };
        previousVariants = (last.variantResults as VariantVerification | null) ?? null;
        for (const [url, ref] of Object.entries(last.captures as Record<string, StoredCaptureRef>)) {
          if (!ref.captureId || reuse[url]) continue;
          // Final review M1: a refresh reads the last Verify's own pages whatever their age — never a page load.
          const c = refresh ? await readCaptureFile(ref.captureId) : await loadStoredCapture(ref);
          if (c) { reuse[url] = c; reusedRefs.set(url, ref); }
        }
      }
    }

    // Proof pages captured for marking (spec 2026-09-18 §3.5) are the same
    // captures verification would take; use them while fresh. A previous
    // verification's own captures, when reused above, stay in charge: the
    // stored result was proven on those. A refresh reads only the check's
    // pages and the last Verify's (final review M1).
    if (!refresh) {
      const proofPages = await loadProofPageCaptures(sourceId, set.urls.filter((u) => !reuse[u]));
      for (const [url, p] of Object.entries(proofPages)) { reuse[url] = p.capture; reusedRefs.set(url, p.ref); }
    }

    before = usage.snapshot();
    // A free run (spec 2026-10-17 §10 property 9) has no agent at all, so no field in it can reach the AI.
    // Spec 2026-10-24 metering §2.3: the organisation's monthly AI limit, read before any AI. At the limit no model is
    // built — every call is refused before it is made, so a field that needs AI resolves `ai_unavailable` (the existing
    // badge and sentence); below it, each call is projected at the per-field estimate against what is left.
    // The org's slot is taken before the remainder is read (review I1): a sibling job that records its cost and closes
    // meanwhile is then in the read or counted by the slot, never in neither. A website with no org has no limit.
    let cap: CapState | null = null;
    if (!opts.free && process.env.ANTHROPIC_API_KEY) {
      const orgId = await orgIdForSource(db, sourceId);
      ledger = openCapLedger(orgId);
      cap = orgId ? await orgCapState(db, orgId) : { capUsd: null, spentUsd: 0, remainingUsd: null, reached: false };
    }
    const agent = cap && ledger
      ? cappedAgent<ProposePathsAgent>(cap.reached ? NO_MODEL : new SchemaAgent(), {
        remainingUsd: cap.remainingUsd,
        perCallUsd: estAiCostPerFieldUsd(set.urls.length),
        ledger,
      })
      : null;
    const onProgress = (stage: string) =>
      void writeStage(db, verificationId, stage).catch((err) => console.error(`[verify] failed to record stage for ${verificationId}:`, err));
    const { run, variantResults, holdPlan } = await withBrowserSession(async (browser) => {
      const run = await runVerification({ fields, verificationSet: set }, {
        browser,
        agent,
        captures: reuse,
        onlyKeys: opts.onlyKeys,
        ...(opts.free ? { free: true } : {}),
        previous,
        cachedPaths: (concept) => lookupVerifiedPaths(hostname, 'detail', concept),
        onProgress,
        // Final review M1: a page neither the check nor the last Verify read is not read now — not loaded live.
        ...(refresh ? { captureOne: notLoadedNow } : {}),
      });
      // Variants (spec 2026-10-01 §4) ride on the same run and never fail it: a
      // throw is reported as a failed variant check, the fields' result stands.
      let variantResults: VariantVerification | null = null;
      if (checkVariants && opts.origin === 'refresh') {
        variantResults = previousVariants;
      } else if (checkVariants) {
        onProgress('checking variants');
        const args = { sourceId, set, setup: variantSetup!, datasetSchema: source.dataset?.schema };
        try {
          variantResults = await runVariantCheck({ ...args, fields, results: run.outcome.fields, captures: run.captures }, { browser });
        } catch (err) {
          console.error(`[verify] variant check for ${verificationId} failed:`, err);
          variantResults = { method: variantSetup!.method as 'list' | 'links', hash: currentVariantHash(args), passed: false, problem: VARIANT_CHECK_FAILED, pages: {} };
        }
      }
      // Spec 2026-10-21 §3.1: which fields this Verify did not pass keep their last good certification —
      // read on this Verify's own captures, the way a run would (no page load, no model call).
      const holdPlan: HoldPlan = await decideHolds({
        fields,
        set,
        keys: opts.onlyKeys ?? fields.map((f) => f.key),
        outcome: run.outcome.fields,
        certifying: (key) => certifyingResult(certifiedBefore, key),
        captures: run.captures,
        browser,
        failedVerificationId: verificationId,
        // Spec §3.1: a Verify that could load no proof page at all learned nothing — the hold stands.
        nothingCaptured: 'hold',
      });
      return { run, variantResults, holdPlan };
    });
    // Stopped meanwhile (stuck, lease lost, shutdown): its pages were read by a browser closed under it.
    // Nothing is stored or written; the row is the runner's or the next claim's (final review I1).
    if (jobStopped()) return;    const cost = usage.costUsd(before);

    const captureRefs: Record<string, StoredCaptureRef> = {};
    for (const url of set.urls) {
      const c = run.captures[url];
      const reused = reusedRefs.get(url);
      if (c && reused) captureRefs[url] = reused;                       // no new captures row for a reused page
      else if (c) captureRefs[url] = await storeCapture(sourceId, url, c);
      else captureRefs[url] = { captureId: '', capturedAt: new Date().toISOString(), blockedReason: run.captureErrors[url] ?? BROWSER_UNAVAILABLE };
    }

    // One transaction (spec 2026-10-21 §3.1): no reader sees a field uncertified between the result and its hold.
    const wrote = await db.transaction(async (tx) => {
      if (jobStopped()) return false;      const [won] = await tx.update(sourceVerifications).set({
        results: run.outcome.fields,
        variantResults,
        captures: captureRefs,
        allPassed: run.outcome.allPassed,
        aiCalls: run.outcome.aiCalls,
        // Added, never set: a stopped earlier attempt on this row already recorded what it spent (review I2).
        costUsd: sql`${sourceVerifications.costUsd} + ${cost.toFixed(4)}::numeric`,
        completedAt: new Date(),
      }).where(and(eq(sourceVerifications.id, verificationId), isNull(sourceVerifications.completedAt)))
        .returning({ id: sourceVerifications.id });
      // Closed meanwhile (the runner stopped this attempt as stuck): a late attempt writes nothing (spec §7.6).
      if (!won) return false;
      await writeHolds(tx, sourceId, holdPlan);
      // The pages were just read: the scheduled check need not read them again for a while (spec §3.3).
      await tx.update(sources).set({ nextCheckAt: nextCheckAt() }).where(eq(sources.id, sourceId));
      return true;
    });
    // Only once the transaction has committed is its added cost really recorded (re-review N1).
    if (wrote) costRecorded = true;
    if (!wrote) return;
    if (run.outcome.allPassed) {
      const byConcept: Record<string, CertifiedPath[]> = {};
      for (const f of fields) (byConcept[f.concept] ??= []).push(...run.outcome.fields[f.key]!.certified);
      await saveVerifiedPaths(hostname, 'detail', byConcept, set.urls[0]!);
      await db.update(sources).set({ driftedFields: null, updatedAt: new Date() }).where(eq(sources.id, sourceId));
      // The coverage check (spec 2026-10-10 §A1): free, in the background; only its start is awaited. Never after a refresh's own
      // re-verify (spec 2026-10-21 §7.6, follow-ups §2): the scheduled check that started it runs its own listing sample.
      if (!refresh) await startCoverage(sourceId, verificationId).catch((err) => console.error(`[coverage] could not start for ${sourceId}:`, err));
    }

    // Spec 2026-10-21 §3.3: fields this Verify left held are checked on its own captures (no page load) —
    // what changed, and whether it changed by nature. Never after a refresh's own re-verify (§7.6).
    if (!refresh && holdPlan.upsert.length > 0) {
      await startCheck(sourceId, holdPlan.upsert.map((h) => h.fieldKey), captureRefs)
        .catch((err) => console.error(`[verify] the check after ${verificationId} could not start:`, err));
    }

    // Jev at Verify, in shadow (spec 2026-10-16 §7): Jev's picks against what the customer
    // verified, on this row's verify_agreement only — after the certification writes and never
    // awaited, so measurement never delays certification. It never throws; the catch is a backstop.
    void recordJevAgreement(verificationId, sourceId, fields, set, captureRefs, run.outcome.fields)
      .catch((err) => console.error(`[jev] agreement for ${verificationId} failed:`, err));
  } catch (err) {
    // Stopped: the failure is the closed browser, not the website — the row is left open (final review I1).
    if (jobStopped()) return;    console.error(`[verify] verification ${verificationId} failed:`, err);
    try {
      await db.update(sourceVerifications).set({
        errorMessage: stripAnsi(safeErrorMessage(err)).slice(0, 1000),
        completedAt: new Date(),
      }).where(and(eq(sourceVerifications.id, verificationId), isNull(sourceVerifications.completedAt)));
    } catch (recoveryErr) {
      console.error(`[verify] failed to record failure for ${verificationId}:`, recoveryErr);
    }
  } finally {
    if (before && !costRecorded) await recordSpend(verificationId, usage, before);
    ledger?.close(); // the cost is recorded: the org's other jobs read it from the database now
    // Spec 2026-10-24 email §3.2: whatever this Verify wrote (holds, a pass, a failure) may have turned "Needs
    // attention" on or off — a customer's Verify and a refresh's re-verify alike. After the commit: the attention view
    // reads committed rows. A stopped attempt wrote nothing. Never throws.
    if (!jobStopped()) await syncAttentionSafely(db, sourceId);
  }
}
