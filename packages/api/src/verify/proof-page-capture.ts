// packages/api/src/verify/proof-page-capture.ts
// The background body behind `sources.captureProofPage`: one captures row per
// request, its metadata the state machine the stepper polls. The body runs in
// the worker as the `proof-page-capture` job (spec 2026-10-23 §4.4); it never
// rejects and always leaves the row terminal, or `waiting` with its next try
// queued (the ladder, spec 2026-10-28 §3.2). A row closed meanwhile (the
// runner stopped a stuck attempt) is never written again by that attempt.
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, desc, sql } from 'drizzle-orm';
import { db, captures, sources } from '@robot/db';
import { TILE_HEIGHT, CaptureError, BROWSER_UNAVAILABLE, verdictSentence, type CaptureErrorKind, type CaptureVerdict, type PageCapture } from '@robot/browser';
import { backoffAnswer, backoffRemainingMs, captureProofPage, CaptureProblemError, reportVerdict, CAPTURE_REUSE_MAX_AGE_MS, type Box, type Route } from '@robot/scraper';
import { withBrowserSession } from '../browser-session.js';
import { forWebsite } from '../proxy/website-session.js';
import { fallbackFor, markFallbackKept } from '../proxy/fallback.js';
import { safeErrorMessage } from '../crawl/plan-source.js';
import { writeCaptureFile, readCaptureFile, persistTiles, type StoredCaptureRef } from './capture-store.js';
import { startJevReading } from './jev-reading.js';
import { enqueue } from '../jobs/enqueue.js';
import { currentJobId, jobStopped } from '../jobs/context.js';
import { isJobLive, type DbOrTx } from '../jobs/queue.js';

/** Every write after the start is fenced on it: a row closed meanwhile (stalled, retried) is left as it is (spec 2026-10-23 §7.6). */
const stillCapturing = sql`${captures.metadata}->>'status' = 'capturing'`;
/**
 * A row this job may take (spec 2026-10-28 §3.2): its try running, or waiting for its next one — and then only by the
 * job the row names. An earlier try's job claimed again (its worker died after queueing the next) takes nothing.
 */
const takeableBy = (jobId: string | null) => jobId
  ? sql`(${captures.metadata}->>'status' = 'capturing' OR (${captures.metadata}->>'status' = 'waiting' AND ${captures.jobId} = ${jobId}::uuid))`
  : sql`${captures.metadata}->>'status' = 'capturing'`;

/** The tries one capture takes when the website turns it away (spec 2026-10-28 §3.2). */
export const LADDER_TRIES = 4;

const MIN = 60_000;
/**
 * The ladder's waits (spec 2026-10-28 §3.2): try 2 two minutes after try 1's wall; try 3 at once by the fallback,
 * else four minutes after try 2; try 4 four minutes after a fallback try 3, else eight.
 */
export const LADDER_WAITS = { second: 2 * MIN, third: 4 * MIN, thirdByFallback: 0, fourth: 8 * MIN, fourthByFallback: 4 * MIN } as const;

/**
 * Retries of one website on one host and route come back at least this far apart (review I1): products walled
 * together would otherwise all wake at the same backoff end and wall each other again. Scaled like the waits.
 */
export const RETRY_SPACING_MS = 30_000;

/** A start answered from the backoff stops waiting this long after the first try started: the row gives up (review M3). */
export const DEFERRAL_LIMIT_MS = 30 * MIN;

/** `PROOF_LADDER_WAIT_SCALE` (test-only; the live check shortens the waits with it): a non-negative number, default 1. */
export function ladderWaitScale(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PROOF_LADDER_WAIT_SCALE?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

export type NextTry = { attempt: number; via: Route; waitMs: number };

/**
 * After try `attempt` walled on `route`: the try that comes next, its route and how long until it starts — never
 * before that route's backoff ends (`backoffMs`, spec §3.4) — or 'give-up' after the last. `fallback`: the website
 * may switch to the fallback route (`fallbackFor(...).available`); it is taken at try 3 only. The ladder's waits are
 * multiplied by `scale` (default `ladderWaitScale()`); the backoff is not.
 */
export function nextTry(i: { attempt: number; route: Route; fallback: boolean; backoffMs: Partial<Record<Route, number>>; scale?: number }): NextTry | 'give-up' {
  if (i.attempt >= LADDER_TRIES) return 'give-up';
  const scale = i.scale ?? ladderWaitScale();
  let via: Route = i.route;
  let wait: number;
  if (i.attempt <= 1) wait = LADDER_WAITS.second;
  else if (i.attempt === 2) {
    if (i.fallback && i.route === 'direct') { via = 'fallback'; wait = LADDER_WAITS.thirdByFallback; } else wait = LADDER_WAITS.third;
  } else wait = i.route === 'fallback' ? LADDER_WAITS.fourthByFallback : LADDER_WAITS.fourth;
  return { attempt: i.attempt + 1, via, waitMs: Math.max(Math.round(wait * scale), i.backoffMs[via] ?? 0) };
}

/**
 * Where a capture stands across its tries (spec 2026-10-28 §3.1): the try (1..4), when the first one started (the
 * countdown's and the give-up sentence's clock) and the route it took. Rows written before the ladder have none.
 */
type TryFields = { attempt?: number; firstStartedAt?: string; via?: Route };

export type ProofPageMeta =
  | ({ kind: 'proof-page'; status: 'capturing'; url: string; startedAt: string } & TryFields)
  | ({
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
    } & TryFields)
  | {
      kind: 'proof-page'; status: 'failed'; url: string; startedAt: string; error: string;
      /** The browser's verdict when that is why the page was not captured (spec 2026-10-09 §A1); absent for other failures and rows written before verdicts. */
      verdict?: CaptureVerdict | { kind: CaptureErrorKind };
      /** The tries it took, when more than one (spec 2026-10-28 §3.1). */
      attempts?: number;
      firstStartedAt?: string;
      /** Set only when the ladder ran out on walls: every try was turned away. */
      gaveUp?: true;
      /** The route of the last try, on a row of more than one try (ops reads "even through the proxy" from it, spec §3.5). */
      via?: Route;
    }
  | {
      /** Turned away; the next try is a queued job due at `retryAt` (spec 2026-10-28 §3.1). */
      kind: 'proof-page'; status: 'waiting'; url: string; startedAt: string; firstStartedAt: string;
      /** The wall's stored sentence (as a failed row's). */
      error: string;
      verdict: CaptureVerdict | { kind: CaptureErrorKind };
      /** ISO; when the next try starts. */
      retryAt: string;
      /** The try that comes next: 2..4, or the same one when the last start was answered from the backoff. */
      attempt: number;
      /** The route the next try takes. */
      via: Route;
    };

type Session = typeof withBrowserSession;

type CapturedProofPage = Extract<ProofPageMeta, { status: 'captured' }>;
type WaitingProofPage = Extract<ProofPageMeta, { status: 'waiting' }>;

export type ProofPageCaptureRecord = { ref: StoredCaptureRef; capture: PageCapture; meta: CapturedProofPage };

export const SUPERSEDED = 'cancelled: a newer capture of this page started';

/**
 * A new capture of a page supersedes its waiting one (spec 2026-10-28 §3.2): the older row's queued next try is
 * failed before it starts; the row itself is left as it is (the screen reads the newest row per URL). A try
 * already running is stopped by its own fence (`supersededSql`).
 */
async function cancelWaitingTries(tx: DbOrTx, sourceId: string, url: string): Promise<void> {
  const result = JSON.stringify({ error: { kind: 'unavailable', message: SUPERSEDED } });
  await tx.execute(sql`
    UPDATE jobs SET status = 'failed', error = ${SUPERSEDED}, result = ${result}::jsonb, finished_at = now(),
           locked_by = NULL, locked_until = NULL
     WHERE status = 'queued' AND type = 'proof-page-capture' AND id IN (
           SELECT job_id FROM captures WHERE source_id = ${sourceId} AND url = ${url} AND job_id IS NOT NULL
              AND metadata->>'kind' = 'proof-page' AND metadata->>'status' = 'waiting')`);
}

/** True for a row with a newer proof-page row of the same website and page: it is not the one the screen reads. */
const supersededSql = (captureId: string) => sql`EXISTS (
  SELECT 1 FROM captures newer, captures me WHERE me.id = ${captureId} AND newer.source_id = me.source_id AND newer.url = me.url
     AND newer.created_at > me.created_at AND newer.metadata->>'kind' = 'proof-page')`;

/**
 * Inserts a `capturing` row (spec 2026-09-18 §3.1). Fired (the default): its `proof-page-capture` job is
 * enqueued in the same transaction and the worker takes it (spec 2026-10-23 §4.4). `fire: false`: the caller
 * runs `runProofPageCapture` itself (the drift check, scripts); the row then belongs to the caller's job.
 * Either way a waiting capture of the same page is superseded (spec 2026-10-28 §3.2).
 */
export async function startProofPageCapture(sourceId: string, url: string, opts: { fire?: boolean } = {}): Promise<{ captureId: string }> {
  const meta: ProofPageMeta = { kind: 'proof-page', status: 'capturing', url, startedAt: new Date().toISOString() };
  const id = randomUUID();
  const fire = opts.fire ?? true;
  await db.transaction(async (tx) => {
    await cancelWaitingTries(tx, sourceId, url);
    const jobId = fire ? await enqueue(tx, 'proof-page-capture', { captureId: id }, { key: `capture:${id}` }) : currentJobId();
    await tx.insert(captures).values({ id, sourceId, url, metadata: meta, jobId });
  });
  return { captureId: id };
}

/**
 * `jev` (default true): whether a successful capture starts a Jev reading. The drift check passes
 * false: its re-captures are not pages a customer is verifying, and a reading is paid (whole-branch
 * review I1).
 * `ladder` (default false): a wall is retried later (spec 2026-10-28 §3.2) — the worker's job passes true. Without
 * it (the drift check, scripts: `fire: false`, no job of the row's own to queue again) a wall fails at once.
 */
export type CaptureRunOptions = { jev?: boolean; ladder?: boolean };

const isWall = (v: CaptureVerdict | { kind: CaptureErrorKind } | undefined) => v?.kind === 'refused' || v?.kind === 'challenge';

export async function runProofPageCapture(captureId: string, session: Session = withBrowserSession, opts: CaptureRunOptions = {}): Promise<void> {
  const row = await db.query.captures
    .findFirst({ where: eq(captures.id, captureId), columns: { id: true, sourceId: true, url: true, metadata: true } })
    .catch(() => null);
  if (!row) return;
  const stored = row.metadata as ProofPageMeta | null;
  // A row already closed (stalled, or failed by a stopped attempt) is not taken again.
  if (stored?.status !== 'capturing' && stored?.status !== 'waiting') return;
  const ladder = opts.ladder === true;
  // A newer capture of this page started meanwhile: this one is not on screen any more and loads nothing.
  if (ladder && await isSuperseded(captureId)) return;

  const site = await db.query.sources
    .findFirst({ where: eq(sources.id, row.sourceId), columns: { proxyUrl: true, country: true, fallbackProxyAt: true } })
    .catch(() => undefined);
  const fallback = fallbackFor(site ?? { proxyUrl: null, country: null, fallbackProxyAt: null }, row.url);
  // The website's own route: the fallback when it kept it (and the address is still set), else direct (an own
  // address or DEFAULT_PROXY_URL back off as the host, as before).
  const usual: Route = !fallback.available && fallback.reason === 'already' ? 'fallback' : 'direct';
  const attempt = stored.attempt ?? 1;
  // A website that keeps the fallback (another product's fallback try read its page meanwhile) loads by it, whatever the row said.
  let route: Route = usual === 'fallback' ? 'fallback' : (stored.via ?? 'direct');
  // A switch to the fallback the website does not keep: still available now? Else the try goes the usual way.
  const switchTo = route === 'fallback' && usual === 'direct' && fallback.available ? { country: fallback.country } : null;
  if (route === 'fallback' && usual === 'direct' && !switchTo) route = 'direct';

  // The capture's clock starts now, with the work, not at the insert:
  // the stall rule measures work, not time spent in the queue (final review M4).
  const startedAt = new Date().toISOString();
  const firstStartedAt = stored.firstStartedAt ?? startedAt;
  const meta: ProofPageMeta = { kind: 'proof-page', status: 'capturing', url: row.url, startedAt, attempt, firstStartedAt, via: route };
  const fence = and(eq(captures.id, captureId), takeableBy(currentJobId()), ladder ? sql`NOT ${supersededSql(captureId)}` : undefined);
  const began = await db.update(captures).set({ metadata: meta }).where(fence).returning({ id: captures.id })
    .catch((e) => { console.error(`[proof-page] failed to record the start of ${captureId}:`, e); return [{ id: captureId }]; });
  if (began.length === 0) return;
  const hostname = hostOf(row.url);
  const tries = { attempts: attempt, firstStartedAt, via: route };

  // A host still backing off after a wall is answered from the backoff, with
  // no browser (review I4, 2026-10-09). On the ladder that start does not
  // count: the same try waits for the backoff's end (spec 2026-10-28 §3.2).
  // Without it the card fails with the wall's verdict and the wait, and Try
  // again is the way back.
  const answered = backoffAnswer(row.url, undefined, route);
  if (answered) {
    // Waited long enough on other products' walls: the row gives up with the tries it made (review M3).
    if (ladder && Date.now() - Date.parse(firstStartedAt) > DEFERRAL_LIMIT_MS) {
      const failed: ProofPageMeta = {
        kind: 'proof-page', status: 'failed', url: row.url, startedAt, error: verdictSentence(answered.verdict, row.url), verdict: answered.verdict,
        attempts: Math.max(attempt - 1, 0), firstStartedAt, gaveUp: true, via: route,
      };
      await db.update(captures).set({ metadata: failed }).where(and(eq(captures.id, captureId), stillCapturing))
        .catch((e) => console.error(`[proof-page] failed to record the give-up of ${captureId}:`, e));
      return;
    }
    if (ladder) {
      const retryAt = new Date(Date.now() + answered.waitMs);
      const waiting: WaitingProofPage = {
        kind: 'proof-page', status: 'waiting', url: row.url, startedAt, firstStartedAt, error: verdictSentence(answered.verdict, row.url),
        verdict: answered.verdict, retryAt: retryAt.toISOString(), attempt, via: route,
      };
      // Its own key: the job running now may hold `capture:<id>:<attempt>` (a deferral of a deferral, too).
      if (await scheduleNext(captureId, row.sourceId, waiting, `capture:${captureId}:${attempt}:wait-${randomUUID().slice(0, 8)}`)) return;
    }
    const failed: ProofPageMeta = { kind: 'proof-page', status: 'failed', url: row.url, startedAt, error: answered.message, verdict: answered.verdict, ...(attempt > 1 ? tries : {}) };
    await db.update(captures).set({ metadata: failed }).where(and(eq(captures.id, captureId), stillCapturing))
      .catch((e) => console.error(`[proof-page] failed to record the backoff answer for ${captureId}:`, e));
    return;
  }
  try {
    const open = switchTo ? forWebsite(row.sourceId, session, { via: 'fallback', country: switchTo.country }) : forWebsite(row.sourceId, session);
    const { capture, boxes } = await open((browser) => captureProofPage(browser, row.url));
    // Stopped meanwhile (stuck, lease lost, shutdown): the row is the runner's or the next claim's now (final review I1).
    if (jobStopped()) return;
    if (hostname) reportVerdict(hostname, capture.verdict, undefined, route);
    if (switchTo) await keepFallback(row.sourceId, switchTo.country);
    const tiles = await persistTiles(capture.screenshotTiles);
    await writeCaptureFile(captureId, capture);
    const pageHeight = capture.pageHeight ?? 0;
    const strip = tiles.length * TILE_HEIGHT;
    const capturedHeight = pageHeight > 0 ? Math.min(pageHeight, strip) : strip;
    // Below the last tile there is no pixel to outline, so a box down there is an index the viewer could never draw.
    const visible = boxes.filter((b) => b.rect.y < capturedHeight);
    const contentHeight = visible.reduce((h, b) => Math.max(h, b.rect.y + b.rect.h), 0);
    const done: ProofPageMeta = {
      kind: 'proof-page', status: 'captured', url: row.url, startedAt, capturedAt: new Date().toISOString(), tiles, boxes: visible, pageHeight, capturedHeight, contentHeight,
      ...(capture.title?.trim() ? { title: capture.title.trim().slice(0, 120) } : {}), attempt, firstStartedAt, via: route,
    };
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
    if (verdict && hostname) reportVerdict(hostname, err instanceof CaptureProblemError && err.verdict ? err.verdict : verdict.kind, undefined, route);
    // The page answered by the fallback, only not with the variant named: the route works (spec §3.3).
    if (switchTo && verdict?.kind === 'wrong-variant') await keepFallback(row.sourceId, switchTo.country);
    const error = err instanceof CaptureProblemError || err instanceof CaptureError ? safeErrorMessage(err).slice(0, 1000) : BROWSER_UNAVAILABLE;
    // Only a wall climbs the ladder (spec §3.2): a page that refused or challenged the browser.
    let gaveUp = false;
    if (ladder && verdict && isWall(verdict)) {
      const next = nextTry({
        attempt, route, fallback: route === 'direct' && fallback.available,
        backoffMs: { direct: hostname ? backoffRemainingMs(hostname) : 0, fallback: hostname ? backoffRemainingMs(hostname, undefined, 'fallback') : 0 },
      });
      if (next === 'give-up') gaveUp = true;
      else {
        const waiting: WaitingProofPage = {
          kind: 'proof-page', status: 'waiting', url: row.url, startedAt, firstStartedAt, error, verdict,
          retryAt: new Date(Date.now() + next.waitMs).toISOString(), attempt: next.attempt, via: next.via,
        };
        if (await scheduleNext(captureId, row.sourceId, waiting, `capture:${captureId}:${next.attempt}`)) return;
        // Superseded meanwhile (or the queue would not take it): the wall is this row's answer.
      }
    }
    const failed: ProofPageMeta = {
      kind: 'proof-page', status: 'failed', url: row.url, startedAt, error, ...(verdict ? { verdict } : {}),
      ...(attempt > 1 || gaveUp ? tries : {}), ...(gaveUp ? { gaveUp: true as const } : {}),
    };
    await db.update(captures).set({ metadata: failed }).where(and(eq(captures.id, captureId), stillCapturing))
      .catch((e) => console.error(`[proof-page] failed to record failure for ${captureId}:`, e));
  }
}

/**
 * The earliest moment at or after `wantMs` that is at least `spacingMs` from every one of `takenMs` (review I1).
 * Pure; exported for its test.
 */
export function spacedRetry(wantMs: number, takenMs: number[], spacingMs: number): number {
  let at = wantMs;
  for (const t of [...takenMs].sort((a, b) => a - b)) if (Math.abs(at - t) < spacingMs) at = t + spacingMs;
  return at;
}

/**
 * Writes the `waiting` row and queues its next try in one transaction (spec 2026-10-28 §3.2): the job due at
 * `retryAt` under `key`, and `captures.job_id` pointed at it. Fenced on the row still capturing and not superseded;
 * false when it wrote nothing (the caller then fails the row as before the ladder).
 *
 * `retryAt` is first moved off the other waiting rows of the website on the same host and route (review I1): at
 * least `RETRY_SPACING_MS` from each one whose next try is still queued. A lock per website serialises the choice,
 * across workers too.
 */
async function scheduleNext(captureId: string, sourceId: string, planned: WaitingProofPage, key: string): Promise<boolean> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`proof-page-retry:${sourceId}`}))`);
      const others = (await tx.execute(sql`
        SELECT c.url, c.metadata->>'retryAt' AS retry_at FROM captures c JOIN jobs j ON j.id = c.job_id
         WHERE c.source_id = ${sourceId} AND c.id <> ${captureId} AND j.status = 'queued'
           AND c.metadata->>'kind' = 'proof-page' AND c.metadata->>'status' = 'waiting' AND c.metadata->>'via' = ${planned.via}`)) as unknown as Array<{ url: string; retry_at: string | null }>;
      const host = hostOf(planned.url);
      const taken = others.filter((o) => o.retry_at && hostOf(o.url) === host).map((o) => Date.parse(o.retry_at!)).filter(Number.isFinite);
      const retryAtMs = spacedRetry(Date.parse(planned.retryAt), taken, Math.round(RETRY_SPACING_MS * ladderWaitScale()));
      const waiting: WaitingProofPage = { ...planned, retryAt: new Date(retryAtMs).toISOString() };
      const [w] = await tx.update(captures).set({ metadata: waiting })
        .where(and(eq(captures.id, captureId), stillCapturing, sql`NOT ${supersededSql(captureId)}`)).returning({ id: captures.id });
      if (!w) return false;
      const jobId = await enqueue(tx, 'proof-page-capture', { captureId }, { key, runAfter: new Date(waiting.retryAt) });
      await tx.update(captures).set({ jobId }).where(eq(captures.id, captureId));
      return true;
    });
  } catch (e) {
    console.error(`[proof-page] could not queue the next try of ${captureId}:`, e);
    return false;
  }
}

async function isSuperseded(captureId: string): Promise<boolean> {
  const r = (await db.execute(sql`SELECT ${supersededSql(captureId)} AS superseded`).catch(() => [])) as unknown as Array<{ superseded: boolean }>;
  return r[0]?.superseded === true;
}

async function keepFallback(sourceId: string, country: string | null): Promise<void> {
  await markFallbackKept(sourceId, country).catch((e) => console.error(`[proof-page] could not keep the fallback route for ${sourceId}:`, e));
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
 * proof-page row. A `capturing` or `waiting` row whose job is live (queued
 * within its window, or running under its lease) is in flight however old.
 * Otherwise one younger than `PROOF_PAGE_STALL_MS` — counted from its start,
 * or from its `retryAt` while waiting — is returned untouched and an older one
 * is written `failed` / `'stalled'` so the slot shows its reason and its **Try again**.
 */
export async function resolveStalledProofPage(captureId: string, meta: ProofPageMeta, jobId: string | null): Promise<ProofPageMeta> {
  if (meta.status !== 'capturing' && meta.status !== 'waiting') return meta;
  // Its job is queued or working on it: waiting in the queue is not a stall (spec 2026-10-23 §4.5).
  if (await isJobLive(db, jobId)) return meta;
  const since = meta.status === 'waiting' ? meta.retryAt : meta.startedAt;
  if (!(Date.now() - Date.parse(since) > PROOF_PAGE_STALL_MS)) return meta;
  const failed: ProofPageMeta = { kind: 'proof-page', status: 'failed', url: meta.url, startedAt: meta.startedAt, error: 'stalled', ...(meta.firstStartedAt ? { firstStartedAt: meta.firstStartedAt } : {}) };
  await db.update(captures).set({ metadata: failed }).where(and(eq(captures.id, captureId), sql`${captures.metadata}->>'status' = ${meta.status}`))
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

/**
 * A capture's state as the screen reads it (spec 2026-10-28 §3.1). `via` is the route by name only; no answer
 * carries a proxy address. `startedAt` is the running try's start (the card's timer); `of` is `LADDER_TRIES`.
 */
export type ProofPageCaptureState = {
  captureId: string; status: 'capturing' | 'captured' | 'failed' | 'waiting';
  error?: string; verdict?: CaptureVerdict | { kind: CaptureErrorKind }; title?: string;
  startedAt?: string; retryAt?: string; attempt?: number; of?: number; via?: Route;
  gaveUp?: true; attempts?: number; firstStartedAt?: string;
};

/** The state fields of one row, without its id: `latestProofPageCaptures` and `sources.proofPageCapture` answer these. */
export function proofPageStateOf(meta: ProofPageMeta): Omit<ProofPageCaptureState, 'captureId'> {
  switch (meta.status) {
    case 'capturing':
      return {
        status: 'capturing', startedAt: meta.startedAt,
        ...(meta.attempt ? { attempt: meta.attempt, of: LADDER_TRIES } : {}), ...(meta.via ? { via: meta.via } : {}),
        ...(meta.firstStartedAt ? { firstStartedAt: meta.firstStartedAt } : {}),
      };
    case 'waiting':
      return {
        status: 'waiting', error: meta.error, verdict: meta.verdict, startedAt: meta.startedAt, retryAt: meta.retryAt,
        attempt: meta.attempt, of: LADDER_TRIES, via: meta.via, firstStartedAt: meta.firstStartedAt,
      };
    case 'failed':
      return {
        status: 'failed', error: meta.error, ...(meta.verdict ? { verdict: meta.verdict } : {}),
        // A given-up row also tells its last try's start: the end of the give-up sentence's clock (spec 2026-10-28 §3.6).
        ...(meta.gaveUp ? { gaveUp: true as const, startedAt: meta.startedAt } : {}), ...(meta.attempts ? { attempts: meta.attempts } : {}),
        ...(meta.firstStartedAt ? { firstStartedAt: meta.firstStartedAt } : {}),
      };
    case 'captured':
      return { status: 'captured', ...(meta.title ? { title: meta.title } : {}) };
  }
}

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
    out[r.url] = { captureId: r.id, ...proofPageStateOf(meta) };
  }
  return out;
}
