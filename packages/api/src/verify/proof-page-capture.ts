// packages/api/src/verify/proof-page-capture.ts
// The background body behind `sources.captureProofPage`: one captures row per
// request, its metadata the state machine the stepper polls. The body runs in
// the worker as the `proof-page-capture` job (spec 2026-10-23 §4.4); it never
// rejects and always leaves the row terminal. A row closed meanwhile (the
// runner stopped a stuck attempt) is never written again by that attempt.
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, desc, sql } from 'drizzle-orm';
import { db, captures } from '@robot/db';
import { TILE_HEIGHT, CaptureError, BROWSER_UNAVAILABLE, type CaptureErrorKind, type CaptureVerdict, type PageCapture } from '@robot/browser';
import { backoffAnswer, captureProofPage, CaptureProblemError, reportVerdict, CAPTURE_REUSE_MAX_AGE_MS, type Box } from '@robot/scraper';
import { withBrowserSession } from '../browser-session.js';
import { forWebsite } from '../proxy/website-session.js';
import { safeErrorMessage } from '../crawl/plan-source.js';
import { writeCaptureFile, readCaptureFile, persistTiles, type StoredCaptureRef } from './capture-store.js';
import { startJevReading } from './jev-reading.js';
import { enqueue } from '../jobs/enqueue.js';
import { currentJobId, jobStopped } from '../jobs/context.js';
import { isJobLive } from '../jobs/queue.js';

/** Every write after the start is fenced on it: a row closed meanwhile (stalled, retried) is left as it is (spec 2026-10-23 §7.6). */
const stillCapturing = sql`${captures.metadata}->>'status' = 'capturing'`;

export type ProofPageMeta =
  | { kind: 'proof-page'; status: 'capturing'; url: string; startedAt: string }
  | {
      kind: 'proof-page'; status: 'captured'; url: string; startedAt: string; capturedAt: string; tiles: string[]; boxes: Box[];
      /** The document's own height in page pixels; 0 when the capture did not report one. */
      pageHeight: number;
      /** How much of the document the tiles cover. The viewer says "page cut at N px" when `pageHeight` is larger. */
      capturedHeight: number;
      /**
       * Bottom edge of the lowest mapped box, in page pixels; NOT the captured
       * height. The box map is cut at `BOX_MAP_LIMIT` in document order and
       * skips `<body>` and empty elements, so on a long page this falls short
       * of the strip actually captured.
       */
      contentHeight: number;
      /** The document's `<title>` at capture time, trimmed to 120 chars; absent when the page reported none. */
      title?: string;
    }
  | {
      kind: 'proof-page'; status: 'failed'; url: string; startedAt: string; error: string;
      /** The browser's verdict when that is why the page was not captured (spec 2026-10-09 §A1); absent for other failures and rows written before verdicts. */
      verdict?: CaptureVerdict | { kind: CaptureErrorKind };
    };

type Session = typeof withBrowserSession;

type CapturedProofPage = Extract<ProofPageMeta, { status: 'captured' }>;

export type ProofPageCaptureRecord = { ref: StoredCaptureRef; capture: PageCapture; meta: CapturedProofPage };

/**
 * Inserts a `capturing` row (spec 2026-09-18 §3.1). Fired (the default): its `proof-page-capture` job is
 * enqueued in the same transaction and the worker takes it (spec 2026-10-23 §4.4). `fire: false`: the caller
 * runs `runProofPageCapture` itself (the drift check, scripts); the row then belongs to the caller's job.
 */
export async function startProofPageCapture(sourceId: string, url: string, opts: { fire?: boolean } = {}): Promise<{ captureId: string }> {
  const meta: ProofPageMeta = { kind: 'proof-page', status: 'capturing', url, startedAt: new Date().toISOString() };
  const id = randomUUID();
  if (opts.fire ?? true) {
    await db.transaction(async (tx) => {
      const jobId = await enqueue(tx, 'proof-page-capture', { captureId: id }, { key: `capture:${id}` });
      await tx.insert(captures).values({ id, sourceId, url, metadata: meta, jobId });
    });
  } else {
    await db.insert(captures).values({ id, sourceId, url, metadata: meta, jobId: currentJobId() });
  }
  return { captureId: id };
}

/**
 * `jev` (default true): whether a successful capture starts a Jev reading. The drift check passes
 * false: its re-captures are not pages a customer is verifying, and a reading is paid (whole-branch
 * review I1).
 */
export type CaptureRunOptions = { jev?: boolean };

export async function runProofPageCapture(captureId: string, session: Session = withBrowserSession, opts: CaptureRunOptions = {}): Promise<void> {
  const row = await db.query.captures
    .findFirst({ where: eq(captures.id, captureId), columns: { id: true, sourceId: true, url: true, metadata: true } })
    .catch(() => null);
  if (!row) return;
  // A row already closed (stalled, or failed by a stopped attempt) is not taken again.
  if ((row.metadata as ProofPageMeta | null)?.status !== 'capturing') return;
  // The capture's clock starts now, with the work, not at the insert:
  // the stall rule measures work, not time spent in the queue (final review M4).
  const meta: ProofPageMeta = { kind: 'proof-page', status: 'capturing', url: row.url, startedAt: new Date().toISOString() };
  await db.update(captures).set({ metadata: meta }).where(and(eq(captures.id, captureId), stillCapturing))
    .catch((e) => console.error(`[proof-page] failed to record the start of ${captureId}:`, e));
  const hostname = hostOf(row.url);
  // A host still backing off after a wall is answered from the backoff, with
  // no browser: the card fails with the wall's verdict and how long the wait
  // still is, and Try again is the way back (review I4, 2026-10-09).
  const waiting = backoffAnswer(row.url);
  if (waiting) {
    const failed: ProofPageMeta = { kind: 'proof-page', status: 'failed', url: row.url, startedAt: meta.startedAt, error: waiting.message, verdict: waiting.verdict };
    await db.update(captures).set({ metadata: failed }).where(and(eq(captures.id, captureId), stillCapturing))
      .catch((e) => console.error(`[proof-page] failed to record the backoff answer for ${captureId}:`, e));
    return;
  }
  try {
    const { capture, boxes } = await forWebsite(row.sourceId, session)((browser) => captureProofPage(browser, row.url));
    // Stopped meanwhile (stuck, lease lost, shutdown): the row is the runner's or the next claim's now (final review I1).
    if (jobStopped()) return;
    if (hostname) reportVerdict(hostname, capture.verdict);
    const tiles = await persistTiles(capture.screenshotTiles);
    await writeCaptureFile(captureId, capture);
    const pageHeight = capture.pageHeight ?? 0;
    const strip = tiles.length * TILE_HEIGHT;
    const capturedHeight = pageHeight > 0 ? Math.min(pageHeight, strip) : strip;
    // Below the last tile there is no pixel to outline, so a box down there is an index the viewer could never draw.
    const visible = boxes.filter((b) => b.rect.y < capturedHeight);
    const contentHeight = visible.reduce((h, b) => Math.max(h, b.rect.y + b.rect.h), 0);
    const done: ProofPageMeta = { kind: 'proof-page', status: 'captured', url: row.url, startedAt: meta.startedAt, capturedAt: new Date().toISOString(), tiles, boxes: visible, pageHeight, capturedHeight, contentHeight, ...(capture.title?.trim() ? { title: capture.title.trim().slice(0, 120) } : {}) };
    const [wrote] = await db.update(captures).set({ html: capture.html, screenshotPath: tiles[0] ?? null, metadata: done })
      .where(and(eq(captures.id, captureId), stillCapturing)).returning({ id: captures.id });
    // Closed meanwhile (the runner stopped this attempt as stuck): a late attempt writes nothing and starts nothing.
    if (!wrote) return;
    // Jev at Verify, in shadow (spec 2026-10-16 §3): never awaited, never fails the capture.
    if (opts.jev ?? true) void startJevReading({ sourceId: row.sourceId, captureId, url: row.url, title: done.title ?? '', capture, boxes: visible })
      .catch((e) => console.error(`[jev] could not start for ${captureId}:`, e));
  } catch (err) {
    // The raw text is logged here only. A `CaptureProblemError` or
    // `CaptureError` already carries a customer sentence as its message
    // (verify/capture-check.ts, @robot/browser's CaptureError); anything
    // else is a throw from before any verdict existed — a Playwright
    // exception, hundreds of words, that must never land in `error` for the
    // proof card to show verbatim (campaign 2, 2026-10-11).
    // Stopped: this failure is the closed browser, not the page — nothing is written (final review I1).
    if (jobStopped()) return;
    console.error(`[proof-page] capture ${captureId} failed:`, err);
    const verdict = err instanceof CaptureProblemError ? err.verdict : err instanceof CaptureError ? { kind: err.kind } : undefined;
    if (verdict && hostname) reportVerdict(hostname, err instanceof CaptureProblemError && err.verdict ? err.verdict : verdict.kind);
    const error = err instanceof CaptureProblemError || err instanceof CaptureError ? safeErrorMessage(err).slice(0, 1000) : BROWSER_UNAVAILABLE;
    const failed: ProofPageMeta = { kind: 'proof-page', status: 'failed', url: row.url, startedAt: meta.startedAt, error, ...(verdict ? { verdict } : {}) };
    await db.update(captures).set({ metadata: failed }).where(and(eq(captures.id, captureId), stillCapturing))
      .catch((e) => console.error(`[proof-page] failed to record failure for ${captureId}:`, e));
  }
}

/** Scripts and the drift check still call it by this name; the worker's browser gate is the slot now. */
export const runProofPageCaptureInSlot = runProofPageCapture;

function hostOf(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}

/**
 * A finished proof page, or null — `captures.metadata` is a free-form jsonb
 * column shared with rows this job never wrote (`{ kind: 'verification' }`),
 * so the fields are checked rather than assumed.
 */
function capturedProofPage(metadata: unknown): CapturedProofPage | null {
  const m = metadata as Partial<CapturedProofPage> | null;
  if (!m || m.kind !== 'proof-page' || m.status !== 'captured' || !m.capturedAt || !m.tiles) return null;
  if (typeof m.capturedHeight !== 'number') return null; // a row written before the heights existed — none can, this branch is unmerged
  return m as CapturedProofPage;
}

/**
 * A capture is bounded by navigation, the 8 s ready poll, the 10 s settle and
 * six tile renders — well inside three minutes. A `capturing` row older than
 * this is a crash leftover (the api-server restarted mid-capture), not work in
 * progress, and the slot polling it would otherwise wait forever.
 */
export const PROOF_PAGE_STALL_MS = 3 * 60 * 1000;

/**
 * The row's state as it should be reported, closing out a stalled capture on
 * the way — `resolveInFlightVerification`'s rule (in-flight.ts) for the
 * proof-page row. A `capturing` row whose job is live (queued within its
 * window, or running under its lease) is in flight however old. Otherwise one
 * younger than `PROOF_PAGE_STALL_MS` is returned untouched and an older one is
 * written `failed` / `'stalled'` so the slot shows its reason and its **Try again**.
 */
export async function resolveStalledProofPage(captureId: string, meta: ProofPageMeta, jobId: string | null): Promise<ProofPageMeta> {
  if (meta.status !== 'capturing') return meta;
  // Its job is queued or working on it: waiting in the queue is not a stall (spec 2026-10-23 §4.5).
  if (await isJobLive(db, jobId)) return meta;
  if (!(Date.now() - Date.parse(meta.startedAt) > PROOF_PAGE_STALL_MS)) return meta;
  const failed: ProofPageMeta = { kind: 'proof-page', status: 'failed', url: meta.url, startedAt: meta.startedAt, error: 'stalled' };
  await db.update(captures).set({ metadata: failed }).where(and(eq(captures.id, captureId), stillCapturing))
    .catch((e) => console.error(`[proof-page] failed to close stalled capture ${captureId}:`, e));
  return failed;
}

/** The newest captured proof page per URL for this source, fresh within CAPTURE_REUSE_MAX_AGE_MS, with its capture file loaded. */
export async function loadProofPageCaptures(sourceId: string, urls: string[]): Promise<Record<string, ProofPageCaptureRecord>> {
  if (urls.length === 0) return {};
  const rows = await db.query.captures.findMany({
    where: and(eq(captures.sourceId, sourceId), inArray(captures.url, urls)),
    orderBy: [desc(captures.createdAt)],
    columns: { id: true, url: true, metadata: true },
  });
  const out: Record<string, ProofPageCaptureRecord> = {};
  for (const r of rows) {
    const m = capturedProofPage(r.metadata);
    if (!m || out[r.url]) continue;
    if (Date.now() - Date.parse(m.capturedAt) > CAPTURE_REUSE_MAX_AGE_MS) continue;
    const capture = await readCaptureFile(r.id);
    if (!capture) continue;
    out[r.url] = { ref: { captureId: r.id, capturedAt: m.capturedAt, ...(m.tiles[0] ? { screenshotUrl: m.tiles[0] } : {}) }, capture, meta: m };
  }
  return out;
}

/** One proof-page capture by its id, with its capture file loaded — null unless that row is captured (failed, still capturing, or its file is missing). Freshness is the caller's concern: this is for reading back a capture just taken. */
export async function loadProofPageCaptureById(captureId: string): Promise<ProofPageCaptureRecord | null> {
  const r = await db.query.captures.findFirst({ where: eq(captures.id, captureId), columns: { id: true, metadata: true } });
  const m = r ? capturedProofPage(r.metadata) : null;
  if (!r || !m) return null;
  const capture = await readCaptureFile(r.id);
  if (!capture) return null;
  return { ref: { captureId: r.id, capturedAt: m.capturedAt, ...(m.tiles[0] ? { screenshotUrl: m.tiles[0] } : {}) }, capture, meta: m };
}

export type ProofPageCaptureState = { captureId: string; status: 'capturing' | 'captured' | 'failed'; error?: string; verdict?: CaptureVerdict | { kind: CaptureErrorKind }; title?: string };

/** The newest proof-page capture per URL in whatever state — what a reloaded screen resumes from. Stalled rows are closed on the way; a captured one past the reuse window reads as missing, so the screen re-captures. */
export async function latestProofPageCaptures(sourceId: string, urls: string[]): Promise<Record<string, ProofPageCaptureState | null>> {
  const out: Record<string, ProofPageCaptureState | null> = Object.fromEntries(urls.map((u) => [u, null]));
  const rows = await db.query.captures.findMany({
    where: and(eq(captures.sourceId, sourceId), inArray(captures.url, urls)),
    orderBy: [desc(captures.createdAt)],
    columns: { id: true, url: true, metadata: true, jobId: true },
  });
  const seen = new Set<string>();
  for (const r of rows) {
    const m = r.metadata as ProofPageMeta | null;
    if (!m || m.kind !== 'proof-page' || seen.has(r.url)) continue;
    seen.add(r.url);
    const meta = await resolveStalledProofPage(r.id, m, r.jobId);
    if (meta.status === 'captured' && Date.now() - Date.parse(meta.capturedAt) > CAPTURE_REUSE_MAX_AGE_MS) continue;
    out[r.url] = { captureId: r.id, status: meta.status, ...(meta.status === 'failed' ? { error: meta.error, ...(meta.verdict ? { verdict: meta.verdict } : {}) } : {}), ...(meta.status === 'captured' && meta.title ? { title: meta.title } : {}) };
  }
  return out;
}
