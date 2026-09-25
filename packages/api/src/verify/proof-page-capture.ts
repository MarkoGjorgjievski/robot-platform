// packages/api/src/verify/proof-page-capture.ts
// The background body behind `sources.captureProofPage`: one captures row per
// request, its metadata the state machine the stepper polls. Follows
// run-source-verification.ts's rule: the caller never awaits the run, so it
// never rejects and always leaves the row terminal.
import { and, eq, inArray, desc } from 'drizzle-orm';
import { db, captures } from '@robot/db';
import { TILE_HEIGHT, type PageCapture } from '@robot/browser';
import { captureProofPage, CAPTURE_REUSE_MAX_AGE_MS, type Box } from '@robot/scraper';
import { withBrowserSession } from '../browser-session.js';
import { safeErrorMessage } from '../crawl/plan-source.js';
import { writeCaptureFile, readCaptureFile, persistTiles, type StoredCaptureRef } from './capture-store.js';
import { createLimiter } from './limiter.js';

/** At most three product-page captures run at once — a real browser tab each, so a burst of "mark this page" clicks does not pile up unbounded Chromium processes. */
const captureSlots = createLimiter(3);

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
  | { kind: 'proof-page'; status: 'failed'; url: string; startedAt: string; error: string };

type Session = typeof withBrowserSession;

type CapturedProofPage = Extract<ProofPageMeta, { status: 'captured' }>;

export type ProofPageCaptureRecord = { ref: StoredCaptureRef; capture: PageCapture; meta: CapturedProofPage };

export async function startProofPageCapture(sourceId: string, url: string, opts: { session?: Session; fire?: boolean } = {}): Promise<{ captureId: string }> {
  const meta: ProofPageMeta = { kind: 'proof-page', status: 'capturing', url, startedAt: new Date().toISOString() };
  const [row] = await db.insert(captures).values({ sourceId, url, metadata: meta }).returning({ id: captures.id });
  if (opts.fire ?? true) void captureSlots(() => runProofPageCapture(row!.id, opts.session));
  return { captureId: row!.id };
}

export async function runProofPageCapture(captureId: string, session: Session = withBrowserSession): Promise<void> {
  const row = await db.query.captures
    .findFirst({ where: eq(captures.id, captureId), columns: { id: true, url: true, metadata: true } })
    .catch(() => null);
  if (!row) return;
  const meta = row.metadata as ProofPageMeta;
  try {
    const { capture, boxes } = await session((browser) => captureProofPage(browser, row.url));
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
    const failed: ProofPageMeta = { kind: 'proof-page', status: 'failed', url: row.url, startedAt: meta.startedAt, error: safeErrorMessage(err).slice(0, 1000) };
    await db.update(captures).set({ metadata: failed }).where(eq(captures.id, captureId))
      .catch((e) => console.error(`[proof-page] failed to record failure for ${captureId}:`, e));
  }
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
