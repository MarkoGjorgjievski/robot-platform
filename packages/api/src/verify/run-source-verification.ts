// The fire-and-forget body behind `sources.verify` (task 12) — follows
// `startExecution`'s try/catch-everything shape (crawl/start-execution.ts):
// the caller never awaits this, so it must never reject in a way that
// escapes as an unhandled promise rejection, and every failure path must
// still leave the row terminal (`completedAt` set).

import { and, eq, isNull } from 'drizzle-orm';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageCapture } from '@robot/browser';
import { SchemaAgent, snapshotUsage, diffUsage, estimateCostUsd } from '@robot/agent';
import {
  runVerification,
  saveVerifiedPaths,
  lookupVerifiedPaths,
  CAPTURE_REUSE_MAX_AGE_MS,
  type SchemaDefinitionField,
  type VerificationSet,
  type VerificationOutcome,
  type CertifiedPath,
} from '@robot/scraper';
import { db, sources, sourceVerifications, captures } from '@robot/db';
import type { Database } from '@robot/db';
import { withBrowserSession } from '../browser-session.js';
import { persistScreenshot, getCapturesDir } from '../persist-screenshot.js';
import { safeErrorMessage } from '../crawl/plan-source.js';

type StoredCaptureRef = { captureId: string; capturedAt: string; screenshotUrl?: string; blockedReason?: string };

async function storeCapture(sourceId: string, url: string, c: PageCapture): Promise<StoredCaptureRef> {
  const shot = c.screenshot.length > 0 ? await persistScreenshot(c.screenshot) : null;
  const [row] = await db.insert(captures).values({
    sourceId,
    url,
    html: c.html,
    screenshotPath: shot?.url ?? null,
    metadata: { kind: 'verification' },
  }).returning({ id: captures.id });
  await mkdir(getCapturesDir(), { recursive: true });
  await writeFile(
    join(getCapturesDir(), `${row!.id}.capture.json`),
    JSON.stringify({
      url: c.url,
      html: c.html,
      structuredData: c.structuredData,
      interceptedRequests: c.interceptedRequests.filter((r) => r.isJson && r.parsedJson !== null),
    }),
  );
  return { captureId: row!.id, capturedAt: new Date().toISOString(), ...(shot ? { screenshotUrl: shot.url } : {}) };
}

/** Null on any problem: a missing or unreadable file just means "capture again". */
async function loadStoredCapture(ref: StoredCaptureRef): Promise<PageCapture | null> {
  if (Date.now() - Date.parse(ref.capturedAt) > CAPTURE_REUSE_MAX_AGE_MS) return null;
  try {
    const raw = JSON.parse(await readFile(join(getCapturesDir(), `${ref.captureId}.capture.json`), 'utf-8'));
    return { ...raw, markdown: '', title: '', timestamp: 0, screenshot: Buffer.alloc(0), screenshotTiles: [] } as PageCapture;
  } catch {
    return null;
  }
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

export async function runSourceVerification(sourceId: string, verificationId: string, opts: { onlyKeys?: string[] } = {}): Promise<void> {
  try {
    const source = await db.query.sources.findFirst({
      where: eq(sources.id, sourceId),
      columns: { id: true, schemaDefinition: true, verificationSet: true },
    });
    if (!source) throw new Error(`Source ${sourceId} not found`);
    const fields = source.schemaDefinition as SchemaDefinitionField[];
    const set = source.verificationSet as VerificationSet;
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

    const before = snapshotUsage();
    const agent = process.env.ANTHROPIC_API_KEY ? new SchemaAgent() : null;
    const onProgress = (stage: string) =>
      void writeStage(db, verificationId, stage).catch((err) => console.error(`[verify] failed to record stage for ${verificationId}:`, err));
    const run = await withBrowserSession((browser) => runVerification({ fields, verificationSet: set }, {
      browser,
      agent,
      captures: reuse,
      onlyKeys: opts.onlyKeys,
      previous,
      cachedPaths: (concept) => lookupVerifiedPaths(hostname, 'detail', concept),
      onProgress,
    }));
    const cost = estimateCostUsd(diffUsage(before, snapshotUsage())).usd;

    const captureRefs: Record<string, StoredCaptureRef> = {};
    for (const url of set.urls) {
      const c = run.captures[url];
      const reused = reusedRefs.get(url);
      if (c && reused) captureRefs[url] = reused;                       // no new captures row for a reused page
      else if (c) captureRefs[url] = await storeCapture(sourceId, url, c);
      else captureRefs[url] = { captureId: '', capturedAt: new Date().toISOString(), blockedReason: run.captureErrors[url] ?? 'not captured' };
    }

    await db.update(sourceVerifications).set({
      results: run.outcome.fields,
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
    }
  } catch (err) {
    console.error(`[verify] verification ${verificationId} failed:`, err);
    try {
      await db.update(sourceVerifications).set({
        errorMessage: safeErrorMessage(err).slice(0, 1000),
        completedAt: new Date(),
      }).where(eq(sourceVerifications.id, verificationId));
    } catch (recoveryErr) {
      console.error(`[verify] failed to record failure for ${verificationId}:`, recoveryErr);
    }
  }
}
