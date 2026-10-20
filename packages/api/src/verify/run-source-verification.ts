// The fire-and-forget body behind `sources.verify` (task 12) — follows
// `startExecution`'s try/catch-everything shape (crawl/start-execution.ts):
// the caller never awaits this, so it must never reject in a way that
// escapes as an unhandled promise rejection, and every failure path must
// still leave the row terminal (`completedAt` set).

import { and, eq, isNull } from 'drizzle-orm';
import type { PageCapture } from '@robot/browser';
import { BROWSER_UNAVAILABLE } from '@robot/browser';
import { SchemaAgent, snapshotUsage, diffUsage, estimateCostUsd } from '@robot/agent';
import {
  runVerification,
  saveVerifiedPaths,
  lookupVerifiedPaths,
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
import { loadStoredCapture, writeCaptureFile, type StoredCaptureRef } from './capture-store.js';
import { loadProofPageCaptures } from './proof-page-capture.js';
import { startCoverageCheck } from './run-coverage-check.js';
import { recordJevAgreement } from './jev-agreement.js';

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

export async function runSourceVerification(
  sourceId: string,
  verificationId: string,
  opts: { onlyKeys?: string[]; free?: boolean; startCoverage?: typeof startCoverageCheck } = {},
): Promise<void> {
  const startCoverage = opts.startCoverage ?? startCoverageCheck;
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

    // Re-verify only: reuse the previous completed run's captures when young
    // enough. The row being filled in is the newest, so look past it — and
    // past any failed/stalled row too (fix round 1, minor): a row closed out
    // with errorMessage set (a stall, or a genuine failure) never got as far
    // as writing real results/captures, so it must be skipped in favour of
    // the newest run that actually completed cleanly.
    const reuse: Record<string, PageCapture> = {};
    const reusedRefs = new Map<string, StoredCaptureRef>();
    let previous: VerificationOutcome | undefined;
    if (opts.onlyKeys) {
      const rows = await db.query.sourceVerifications.findMany({
        where: eq(sourceVerifications.sourceId, sourceId),
        orderBy: (t, { desc }) => [desc(t.startedAt)],
        limit: 5,
      });
      const last = rows.find((r) => r.id !== verificationId && r.completedAt !== null && r.errorMessage === null);
      if (last) {
        previous = { fields: last.results as VerificationOutcome['fields'], allPassed: last.allPassed, aiCalls: last.aiCalls };
        for (const [url, ref] of Object.entries(last.captures as Record<string, StoredCaptureRef>)) {
          if (!ref.captureId) continue;
          const c = await loadStoredCapture(ref);
          if (c) { reuse[url] = c; reusedRefs.set(url, ref); }
        }
      }
    }

    // Proof pages captured for marking (spec 2026-09-18 §3.5) are the same
    // captures verification would take; use them while fresh. A previous
    // verification's own captures, when reused above, stay in charge: the
    // stored result was proven on those.
    const proofPages = await loadProofPageCaptures(sourceId, set.urls.filter((u) => !reuse[u]));
    for (const [url, p] of Object.entries(proofPages)) { reuse[url] = p.capture; reusedRefs.set(url, p.ref); }

    const before = snapshotUsage();
    // A free run (spec 2026-10-17 §10 property 9) has no agent at all, so no field in it can reach the AI.
    const agent = !opts.free && process.env.ANTHROPIC_API_KEY ? new SchemaAgent() : null;
    const onProgress = (stage: string) =>
      void writeStage(db, verificationId, stage).catch((err) => console.error(`[verify] failed to record stage for ${verificationId}:`, err));
    const { run, variantResults } = await withBrowserSession(async (browser) => {
      const run = await runVerification({ fields, verificationSet: set }, {
        browser,
        agent,
        captures: reuse,
        onlyKeys: opts.onlyKeys,
        ...(opts.free ? { free: true } : {}),
        previous,
        cachedPaths: (concept) => lookupVerifiedPaths(hostname, 'detail', concept),
        onProgress,
      });
      // Variants (spec 2026-10-01 §4) ride on the same run and never fail it: a
      // throw is reported as a failed variant check, the fields' result stands.
      let variantResults: VariantVerification | null = null;
      if (checkVariants) {
        onProgress('checking variants');
        const args = { sourceId, set, setup: variantSetup!, datasetSchema: source.dataset?.schema };
        try {
          variantResults = await runVariantCheck({ ...args, fields, results: run.outcome.fields, captures: run.captures }, { browser });
        } catch (err) {
          console.error(`[verify] variant check for ${verificationId} failed:`, err);
          variantResults = { method: variantSetup!.method as 'list' | 'links', hash: currentVariantHash(args), passed: false, problem: VARIANT_CHECK_FAILED, pages: {} };
        }
      }
      return { run, variantResults };
    });
    const cost = estimateCostUsd(diffUsage(before, snapshotUsage())).usd;

    const captureRefs: Record<string, StoredCaptureRef> = {};
    for (const url of set.urls) {
      const c = run.captures[url];
      const reused = reusedRefs.get(url);
      if (c && reused) captureRefs[url] = reused;                       // no new captures row for a reused page
      else if (c) captureRefs[url] = await storeCapture(sourceId, url, c);
      else captureRefs[url] = { captureId: '', capturedAt: new Date().toISOString(), blockedReason: run.captureErrors[url] ?? BROWSER_UNAVAILABLE };
    }

    await db.update(sourceVerifications).set({
      results: run.outcome.fields,
      variantResults,
      captures: captureRefs,
      allPassed: run.outcome.allPassed,
      aiCalls: run.outcome.aiCalls,
      costUsd: cost.toFixed(4),
      completedAt: new Date(),
    }).where(eq(sourceVerifications.id, verificationId));
    if (run.outcome.allPassed) {
      const byConcept: Record<string, CertifiedPath[]> = {};
      for (const f of fields) (byConcept[f.concept] ??= []).push(...run.outcome.fields[f.key]!.certified);
      await saveVerifiedPaths(hostname, 'detail', byConcept, set.urls[0]!);
      await db.update(sources).set({ driftedFields: null, updatedAt: new Date() }).where(eq(sources.id, sourceId));
      // The coverage check (spec 2026-10-10 §A1): free, in the background, never awaited.
      void startCoverage(sourceId, verificationId).catch((err) => console.error(`[coverage] could not start for ${sourceId}:`, err));
    }

    // Jev at Verify, in shadow (spec 2026-10-16 §7): Jev's picks against what the customer
    // verified, on this row's verify_agreement only — after the certification writes and never
    // awaited, so measurement never delays certification. It never throws; the catch is a backstop.
    void recordJevAgreement(verificationId, sourceId, fields, set, captureRefs, run.outcome.fields)
      .catch((err) => console.error(`[jev] agreement for ${verificationId} failed:`, err));
  } catch (err) {
    console.error(`[verify] verification ${verificationId} failed:`, err);
    try {
      await db.update(sourceVerifications).set({
        errorMessage: stripAnsi(safeErrorMessage(err)).slice(0, 1000),
        completedAt: new Date(),
      }).where(eq(sourceVerifications.id, verificationId));
    } catch (recoveryErr) {
      console.error(`[verify] failed to record failure for ${verificationId}:`, recoveryErr);
    }
  }
}
