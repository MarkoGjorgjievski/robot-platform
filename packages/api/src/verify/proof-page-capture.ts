// packages/api/src/verify/proof-page-capture.ts
// The background body behind `sources.captureProofPage`: one captures row per
// request, its metadata the state machine the stepper polls. Follows
// run-source-verification.ts's rule: the caller never awaits the run, so it
// never rejects and always leaves the row terminal.
import { and, eq, inArray, desc } from 'drizzle-orm';
import { db, captures } from '@robot/db';
import type { PageCapture } from '@robot/browser';
import { captureProofPage, CAPTURE_REUSE_MAX_AGE_MS, type Box } from '@robot/scraper';
import { withBrowserSession } from '../browser-session.js';
import { safeErrorMessage } from '../crawl/plan-source.js';
import { writeCaptureFile, readCaptureFile, persistTiles, type StoredCaptureRef } from './capture-store.js';

export type ProofPageMeta =
  | { kind: 'proof-page'; status: 'capturing'; url: string; startedAt: string }
  | {
      kind: 'proof-page'; status: 'captured'; url: string; startedAt: string; capturedAt: string; tiles: string[]; boxes: Box[];
      /**
       * Bottom edge of the lowest mapped box, in page pixels; NOT the captured
       * height — the tile PNGs carry that. The box map is cut at
       * `BOX_MAP_LIMIT` in document order and skips `<body>` and empty
       * elements, so on a long page this falls short of the strip actually
       * captured.
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
  if (opts.fire ?? true) void runProofPageCapture(row!.id, opts.session);
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
    const contentHeight = boxes.reduce((h, b) => Math.max(h, b.rect.y + b.rect.h), 0);
    const done: ProofPageMeta = { kind: 'proof-page', status: 'captured', url: row.url, startedAt: meta.startedAt, capturedAt: new Date().toISOString(), tiles, boxes, contentHeight };
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
  return m as CapturedProofPage;
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
