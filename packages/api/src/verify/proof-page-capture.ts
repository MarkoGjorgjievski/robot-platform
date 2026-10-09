// packages/api/src/verify/proof-page-capture.ts
// The background body behind `sources.captureProofPage`: one captures row per
// request, its metadata the state machine the stepper polls. Follows
// run-source-verification.ts's rule: the caller never awaits the run, so it
// never rejects and always leaves the row terminal.
import { and, eq, inArray, desc } from 'drizzle-orm';
import { db, captures } from '@robot/db';
import { TILE_HEIGHT, CaptureError, type CaptureErrorKind, type CaptureVerdict, type PageCapture } from '@robot/browser';
import { captureProofPage, CaptureProblemError, reportVerdict, CAPTURE_REUSE_MAX_AGE_MS, type Box } from '@robot/scraper';
import { withBrowserSession } from '../browser-session.js';
import { safeErrorMessage } from '../crawl/plan-source.js';
import { writeCaptureFile, readCaptureFile, persistTiles, type StoredCaptureRef } from './capture-store.js';
import { createLimiter } from './limiter.js';

/**
 * At most three product-page captures run at once — a real browser tab each, so a burst of "mark this page" clicks does not pile up unbounded Chromium processes.
 * Shared by every proof-page capture in the process: the Verification tab's and the drift check's together (drift repair Task 2, fix round 1).
 */
export const captureSlots = createLimiter(3);

/**
 * Captures started in this process still queued for a slot (final review M4).
 * Their row's `startedAt` is the insert time, so under load the stall rule
 * would close them while they are merely waiting; being in this set is proof
 * they are not a crash leftover (a restart empties it, and they stall as before).
 */
const waitingForSlot = new Set<string>();

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
    }
  | {
      kind: 'proof-page'; status: 'failed'; url: string; startedAt: string; error: string;
      /** The browser's verdict when that is why the page was not captured (spec 2026-10-09 §A1); absent for other failures and rows written before verdicts. */
      verdict?: CaptureVerdict | { kind: CaptureErrorKind };
    };

type Session = typeof withBrowserSession;

type CapturedProofPage = Extract<ProofPageMeta, { status: 'captured' }>;

export type ProofPageCaptureRecord = { ref: StoredCaptureRef; capture: PageCapture; meta: CapturedProofPage };

export async function startProofPageCapture(sourceId: string, url: string, opts: { session?: Session; fire?: boolean } = {}): Promise<{ captureId: string }> {
  const meta: ProofPageMeta = { kind: 'proof-page', status: 'capturing', url, startedAt: new Date().toISOString() };
  const [row] = await db.insert(captures).values({ sourceId, url, metadata: meta }).returning({ id: captures.id });
  if (opts.fire ?? true) {
    void runProofPageCaptureInSlot(row!.id, opts.session);
  }
  return { captureId: row!.id };
}

/**
 * Run a capture once one of the shared `captureSlots` is free, resolving when it is done. While it
 * queues it is marked as waiting, so the stall rule never closes it for time spent in the queue.
 * Never rejects (`runProofPageCapture` does not).
 */
export function runProofPageCaptureInSlot(captureId: string, session?: Session): Promise<void> {
  waitingForSlot.add(captureId);
  return captureSlots(() => runProofPageCapture(captureId, session)).finally(() => waitingForSlot.delete(captureId));
}

export async function runProofPageCapture(captureId: string, session: Session = withBrowserSession): Promise<void> {
  const row = await db.query.captures
    .findFirst({ where: eq(captures.id, captureId), columns: { id: true, url: true, metadata: true } })
    .catch(() => null);
  if (!row) {
    waitingForSlot.delete(captureId);
    return;
  }
  // The capture's clock starts now, with a browser slot, not at the insert:
  // the stall rule measures work, not time spent in the queue (final review M4).
  const meta: ProofPageMeta = { kind: 'proof-page', status: 'capturing', url: row.url, startedAt: new Date().toISOString() };
  await db.update(captures).set({ metadata: meta }).where(eq(captures.id, captureId))
    .catch((e) => console.error(`[proof-page] failed to record the start of ${captureId}:`, e));
  waitingForSlot.delete(captureId);
  const hostname = hostOf(row.url);
  try {
    const { capture, boxes } = await session((browser) => captureProofPage(browser, row.url));
    if (hostname) reportVerdict(hostname, capture.verdict.kind);
    const tiles = await persistTiles(capture.screenshotTiles);
    await writeCaptureFile(captureId, capture);
    const pageHeight = capture.pageHeight ?? 0;
    const strip = tiles.length * TILE_HEIGHT;
    const capturedHeight = pageHeight > 0 ? Math.min(pageHeight, strip) : strip;
    // Below the last tile there is no pixel to outline, so a box down there is an index the viewer could never draw.
    const visible = boxes.filter((b) => b.rect.y < capturedHeight);
    const contentHeight = visible.reduce((h, b) => Math.max(h, b.rect.y + b.rect.h), 0);
    const done: ProofPageMeta = { kind: 'proof-page', status: 'captured', url: row.url, startedAt: meta.startedAt, capturedAt: new Date().toISOString(), tiles, boxes: visible, pageHeight, capturedHeight, contentHeight };
    await db.update(captures).set({ html: capture.html, screenshotPath: tiles[0] ?? null, metadata: done }).where(eq(captures.id, captureId));
  } catch (err) {
    console.error(`[proof-page] capture ${captureId} failed:`, err);
    const verdict = err instanceof CaptureProblemError ? err.verdict : err instanceof CaptureError ? { kind: err.kind } : undefined;
    if (verdict && hostname) reportVerdict(hostname, verdict.kind);
    const failed: ProofPageMeta = { kind: 'proof-page', status: 'failed', url: row.url, startedAt: meta.startedAt, error: safeErrorMessage(err).slice(0, 1000), ...(verdict ? { verdict } : {}) };
    await db.update(captures).set({ metadata: failed }).where(eq(captures.id, captureId))
      .catch((e) => console.error(`[proof-page] failed to record failure for ${captureId}:`, e));
  }
}

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
 * proof-page row. A `capturing` row younger than `PROOF_PAGE_STALL_MS` is
 * returned untouched; an older one is written `failed` / `'stalled'` so the
 * slot shows its reason and its **Try again**.
 */
export async function resolveStalledProofPage(captureId: string, meta: ProofPageMeta): Promise<ProofPageMeta> {
  if (meta.status !== 'capturing') return meta;
  if (waitingForSlot.has(captureId)) return meta; // queued in this process, not stalled
  if (!(Date.now() - Date.parse(meta.startedAt) > PROOF_PAGE_STALL_MS)) return meta;
  const failed: ProofPageMeta = { kind: 'proof-page', status: 'failed', url: meta.url, startedAt: meta.startedAt, error: 'stalled' };
  await db.update(captures).set({ metadata: failed }).where(eq(captures.id, captureId))
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

export type ProofPageCaptureState = { captureId: string; status: 'capturing' | 'captured' | 'failed'; error?: string };

/** The newest proof-page capture per URL in whatever state — what a reloaded screen resumes from. Stalled rows are closed on the way; a captured one past the reuse window reads as missing, so the screen re-captures. */
export async function latestProofPageCaptures(sourceId: string, urls: string[]): Promise<Record<string, ProofPageCaptureState | null>> {
  const out: Record<string, ProofPageCaptureState | null> = Object.fromEntries(urls.map((u) => [u, null]));
  const rows = await db.query.captures.findMany({
    where: and(eq(captures.sourceId, sourceId), inArray(captures.url, urls)),
    orderBy: [desc(captures.createdAt)],
    columns: { id: true, url: true, metadata: true },
  });
  const seen = new Set<string>();
  for (const r of rows) {
    const m = r.metadata as ProofPageMeta | null;
    if (!m || m.kind !== 'proof-page' || seen.has(r.url)) continue;
    seen.add(r.url);
    const meta = await resolveStalledProofPage(r.id, m);
    if (meta.status === 'captured' && Date.now() - Date.parse(meta.capturedAt) > CAPTURE_REUSE_MAX_AGE_MS) continue;
    out[r.url] = { captureId: r.id, status: meta.status, ...(meta.status === 'failed' ? { error: meta.error } : {}) };
  }
  return out;
}
