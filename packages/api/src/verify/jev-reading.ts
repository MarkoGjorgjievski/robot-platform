// packages/api/src/verify/jev-reading.ts
// Jev at Verify, in shadow (spec 2026-10-16): after a proof page is captured,
// one TypeSafe call — the screenshot once in state — says which candidate each
// ambiguous field is and which variant the page shows. Stored in jev_readings,
// shown and measured, NEVER applied: this module writes only its own row.
import { count, eq, gte } from 'drizzle-orm';
import { db, jevReadings, sources } from '@robot/db';
import { TILE_HEIGHT, type PageCapture } from '@robot/browser';
import { isAmbiguous, jevFieldCandidates, jevVariantOptions, type Box, type JevCandidate, type JevField, type JevVariantOption } from '@robot/scraper';
import { contractFields } from '../contract.js';
// One direction only: jev-client.ts holds the model, the request/client types and the TIMEOUT, and
// imports nothing from here; this module re-exports them so callers have one place to import from.
import { JEV_MODEL, JEV_TIMEOUT_MS, typesafeJevClient, type JevClient, type JevQuestion, type JevRequest } from './jev-client.js';
export { JEV_MODEL, type JevClient, type JevQuestion, type JevRequest };

const USD_PER_TOKEN = 0.042 / 1e6;
const DEFAULT_DAILY = 2000;
/** TypeSafe answered "400 Invalid image dimensions" to a 256 px side (experiment 2); 400 was accepted. */
const MIN_TILE_HEIGHT = 400;

export type JevAnswer = { pick: string; p: number };
export type JevAnswers = {
  fields: Record<string, { candidates: JevCandidate[]; pick: string; p: number }>;
  variant?: { entries: JevVariantOption[]; pick: string; p: number; pageMatch: string | null };
};
/** The variant question's key, and its options' key in `state.candidates`. Never a contract field key (those never start with `_`). */
export const VARIANT_KEY = '_variant';

export function jevEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.JEV_SHADOW === '1' && !!env.TYPESAFE_API_KEY;
}
export function jevDailyBudget(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.JEV_DAILY_READINGS?.trim();
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY;
}

/** The stored tile holding the topmost candidate's box; never one shorter than 400 px (TypeSafe rejects slivers); else tile 0. */
export function tileFor(tiles: Buffer[], tileHeights: number[], ys: number[]): number {
  if (tiles.length === 0) return 0;
  const top = ys.length ? Math.min(...ys) : 0;
  let y0 = 0;
  for (let i = 0; i < tiles.length; i++) {
    const h = tileHeights[i] ?? 0;
    if (top >= y0 && top < y0 + h) return h >= MIN_TILE_HEIGHT ? i : Math.max(0, i - 1);
    y0 += h;
  }
  return 0;
}

/** Spec §4: a price question's description (experiment 1's measured wording, "the selected size" made general). */
const PRICE_EXTRA = 'the price a buyer pays now for the selected variant';
/** Experiment 2's measured variant question (28 of 28) and its `none`. */
const VARIANT_INSTRUCTIONS = 'Which of the product\'s variants does the screenshot show as selected — the highlighted size, colour or option in the picker, or the variant named beside the price?';
const VARIANT_NONE = 'None: the screenshot shows no variant as selected';

export type JevBuilt = {
  request: JevRequest;
  fieldCandidates: Record<string, JevCandidate[]>;
  variant: { options: JevVariantOption[]; pageMatch: string | null } | null;
  /** The page y of every candidate's box found by its verbatim text — where the tile is chosen. */
  ys: number[];
};

export function buildJevRequest(input: {
  title: string; fields: JevField[];
  capture: Pick<PageCapture, 'structuredData' | 'interceptedRequests' | 'pageVariant'> & { html?: string };
  boxes: Box[]; tileHeights: number[];
}): JevBuilt | null {
  const questions: JevQuestion[] = [];
  const fieldCandidates: Record<string, JevCandidate[]> = {};
  const candidatesState: JevRequest['state']['candidates'] = {};
  const ys: number[] = [];
  const sd = input.capture.structuredData;
  for (const f of input.fields) {
    const cands = jevFieldCandidates(f, { ldJson: sd?.ldJson ?? [], meta: sd?.meta ?? {} }, input.boxes, input.capture.html ?? '');
    if (!isAmbiguous(f, cands)) continue;
    fieldCandidates[f.key] = cands;
    candidatesState[f.key] = cands.map((c) => ({ id: c.id, value: c.value }));
    const desc = f.concept === 'price' ? PRICE_EXTRA : (f.description ?? '').trim();
    questions.push({
      key: f.key, kind: 'field',
      instructions: `Which of these is the ${f.name} of the product shown${desc ? ` — ${desc}` : ''}? Look at the screenshot.`,
      options: cands.map((c) => ({ id: c.id, label: c.value })),
      noneLabel: `None of the candidates is the product's ${f.name} as the screenshot shows it`,
    });
    for (const c of cands) {
      const b = input.boxes.find((x) => x.text.replace(/\s+/g, ' ').trim() === c.value);
      if (b) ys.push(b.rect.y);
    }
  }
  const found = jevVariantOptions(input.capture);
  const variant = found && found.options.length > 0 ? found : null;
  if (variant) {
    candidatesState[VARIANT_KEY] = variant.options.map((o) => ({ id: o.id, value: o.label }));
    questions.push({ key: VARIANT_KEY, kind: 'variant', instructions: VARIANT_INSTRUCTIONS, options: variant.options.map((o) => ({ id: o.id, label: o.label })), noneLabel: VARIANT_NONE });
  }
  if (questions.length === 0) return null;
  const request: JevRequest = { tileIndex: 0, state: { page_title: input.title, candidates: candidatesState }, questions };
  return { request, fieldCandidates, variant, ys };
}

/** The stored answers: only questions asked, only ids offered (or `none`), probabilities to two places. */
export function answersFrom(built: JevBuilt, raw: Record<string, { choice: string; probabilities: Record<string, number> }>): JevAnswers {
  const out: JevAnswers = { fields: {} };
  for (const q of built.request.questions) {
    const a = raw[q.key];
    if (!a) continue;
    const allowed = new Set([...q.options.map((o) => o.id), 'none']);
    if (!allowed.has(a.choice)) continue;
    const p = Math.round((a.probabilities[a.choice] ?? 0) * 100) / 100;
    if (q.kind === 'field') out.fields[q.key] = { candidates: built.fieldCandidates[q.key]!, pick: a.choice, p };
    else if (built.variant) out.variant = { entries: built.variant.options, pick: a.choice, p, pageMatch: built.variant.pageMatch };
  }
  return out;
}

/** One attempt: rejects after `ms` and aborts the request, so a timed-out call never overlaps the retry. */
function askWithTimeout(client: JevClient, req: Parameters<JevClient['ask']>[0], ms: number): ReturnType<JevClient['ask']> {
  const ctrl = new AbortController();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ctrl.abort(); reject(new Error(`timed out after ${ms} ms`)); }, ms);
    Promise.resolve().then(() => client.ask({ ...req, signal: ctrl.signal }))
      .then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Never rejects; writes only its own row. A 10 s timeout per attempt and one retry — of the request
 * only: the answers are written once, after it, so a database error never sends a second paid request.
 */
export async function runJevReading(readingId: string, built: JevBuilt, image: Buffer, client: JevClient, opts: { timeoutMs?: number } = {}): Promise<void> {
  const ms = opts.timeoutMs ?? JEV_TIMEOUT_MS;
  const fail = (err: unknown) => db.update(jevReadings)
    .set({ status: 'failed', error: (err instanceof Error ? err.message : String(err)).slice(0, 500), completedAt: new Date() })
    .where(eq(jevReadings.id, readingId))
    .catch((e) => console.error(`[jev] failed to record failure for ${readingId}:`, e));
  let res: Awaited<ReturnType<JevClient['ask']>> | null = null;
  let last: unknown;
  for (let attempt = 0; attempt < 2 && !res; attempt++) {
    try { res = await askWithTimeout(client, { image, state: built.request.state, questions: built.request.questions }, ms); } catch (err) { last = err; }
  }
  if (!res) { await fail(last); return; }
  try {
    const tokens = Number.isFinite(res.inputTokens) ? res.inputTokens : 0;
    await db.update(jevReadings).set({
      status: 'done', model: res.model, answers: answersFrom(built, res.answers), inputTokens: tokens,
      costUsd: (tokens * USD_PER_TOKEN).toFixed(6), error: null, completedAt: new Date(),
    }).where(eq(jevReadings.id, readingId));
  } catch (err) {
    console.error(`[jev] could not store the answers of ${readingId}:`, err);
    await fail(err);
  }
}

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Starts a reading for one stored proof-page capture, when the switch is on, the day's budget has
 * room, the capture has none yet and something is ambiguous. Inserts the `running` row, then fires
 * `runJevReading` without awaiting it (`fire: false` leaves that to the caller — tests).
 */
export async function startJevReading(
  input: { sourceId: string; captureId: string; url: string; title: string; capture: PageCapture; boxes: Box[] },
  deps: { client?: JevClient; env?: NodeJS.ProcessEnv; fire?: boolean; now?: Date } = {},
): Promise<{ readingId: string | null; reason?: 'off' | 'budget' | 'exists' | 'nothing-to-ask' }> {
  const env = deps.env ?? process.env;
  if (!jevEnabled(env)) return { readingId: null, reason: 'off' };
  const exists = await db.query.jevReadings.findFirst({ where: eq(jevReadings.captureId, input.captureId), columns: { id: true } });
  if (exists) return { readingId: null, reason: 'exists' };
  const [today] = await db.select({ n: count() }).from(jevReadings).where(gte(jevReadings.createdAt, startOfUtcDay(deps.now ?? new Date())));
  // Count, then insert: captures running at once can each pass this check, so a day overshoots by at most that many.
  if ((today?.n ?? 0) >= jevDailyBudget(env)) return { readingId: null, reason: 'budget' };
  const source = await db.query.sources.findFirst({ where: eq(sources.id, input.sourceId), columns: { id: true }, with: { dataset: { columns: { schema: true } } } });
  const fields: JevField[] = contractFields(source?.dataset?.schema).map((f) => ({
    key: f.key, name: f.name, type: f.type, concept: f.concept, description: typeof f.description === 'string' ? f.description : '',
  }));
  const tiles = input.capture.screenshotTiles ?? [];
  const pageH = input.capture.pageHeight ?? tiles.length * TILE_HEIGHT;
  const tileHeights = tiles.map((_, i) => Math.max(0, Math.min(TILE_HEIGHT, pageH - i * TILE_HEIGHT)));
  const built = buildJevRequest({ title: input.title, fields, capture: input.capture, boxes: input.boxes, tileHeights });
  if (!built) return { readingId: null, reason: 'nothing-to-ask' };
  const tileIndex = tileFor(tiles, tileHeights, built.ys);
  built.request.tileIndex = tileIndex;
  const image = tiles[tileIndex];
  if (!image) return { readingId: null, reason: 'nothing-to-ask' };
  const [row] = await db.insert(jevReadings).values({ sourceId: input.sourceId, captureId: input.captureId, url: input.url, status: 'running' })
    .onConflictDoNothing().returning({ id: jevReadings.id });
  if (!row) return { readingId: null, reason: 'exists' };
  if (deps.fire ?? true) void runJevReading(row.id, built, image, deps.client ?? typesafeJevClient());
  return { readingId: row.id };
}
