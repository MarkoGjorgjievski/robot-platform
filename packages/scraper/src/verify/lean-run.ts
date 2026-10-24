// When a certified run's lean read is enough (spec 2026-10-23 run speed §3.3–3.4). One state per run execution:
// the first items are checked both ways; a miss or a not-shown flag takes today's full capture; three rescues in a
// row, or any disagreement, switch the rest of the run to the full capture; a field whose lean misses the full
// capture confirmed three times is trusted. Pure — runVerifiedExtraction owns the captures.
import type { Shown } from './shown-on-page.js';

export const LEAN_CHECK_ITEMS = 2;
export const LEAN_RESCUE_STREAK = 3;
export const LEAN_CONFIRM_STREAK = 3;
export const LEAN_FIRST_PATH_MS = 1_500;

/** `variants`: the website has a variant plan, so every item takes today's capture (final review I1: nothing compares the variant list a lean capture reads). */
export type LeanReason = 'check' | 'miss' | 'unshown' | 'verdict' | 'switched' | 'off' | 'variants';
type FallbackReason = 'check' | 'miss' | 'unshown' | 'verdict';
/** What one item took — `captures.metadata.lean` (spec §3.5). `fields`: what triggered the fallback, or what a check item disagreed on. */
export type LeanOutcome = { mode: 'lean' | 'full' | 'lean+full'; reason: LeanReason | null; fields: string[]; leanMs: number | null };
/** One field as one capture read it: `value` before defaults (null: no path read), its shown flag, and whether it has paths at all. */
export type FieldReading = { key: string; value: unknown; shown: Shown; hasPaths: boolean };

export type LeanRunState = {
  mode: 'lean' | 'full';
  /** Why the run takes the full capture: switched part-way, turned off by RUN_CAPTURE=full, or a website with variants. */
  why: 'switched' | 'off' | 'variants' | null;
  /** The one sentence for the log when switched. */
  note: string | null;
  checksLeft: number;
  rescueStreak: number;
  /** Per field: confirmations since its last rescue. */
  confirmed: Map<string, number>;
  counts: { lean: number; leanFull: Record<FallbackReason, number>; full: number };
};

export function newLeanRunState(opts: { off?: boolean; variants?: boolean; checks?: number } = {}): LeanRunState {
  return {
    mode: opts.off || opts.variants ? 'full' : 'lean', why: opts.off ? 'off' : opts.variants ? 'variants' : null, note: null,
    checksLeft: opts.checks ?? LEAN_CHECK_ITEMS, rescueStreak: 0, confirmed: new Map(),
    counts: { lean: 0, leanFull: { check: 0, miss: 0, unshown: 0, verdict: 0 }, full: 0 },
  };
}

/** `RUN_CAPTURE=full` turns lean captures off for every run this process executes (the kill switch, spec §3.4).
 * `variants`: the website has a variant plan — its rows are built from the capture, so it runs today's capture throughout. */
export function leanRunStateFromEnv(env: Record<string, string | undefined> = process.env, opts: { variants?: boolean } = {}): LeanRunState {
  return newLeanRunState({ off: (env.RUN_CAPTURE ?? '').trim().toLowerCase() === 'full', variants: !!opts.variants });
}

const trusted = (s: LeanRunState, key: string) => (s.confirmed.get(key) ?? 0) >= LEAN_CONFIRM_STREAK;

/** Does this lean read need today's full capture of the same page? Null: the lean read is written. */
export function fallbackFor(state: LeanRunState, lean: FieldReading[]): { reason: 'check' | 'miss' | 'unshown'; fields: string[] } | null {
  const miss = lean.filter((x) => x.hasPaths && x.value === null && !trusted(state, x.key)).map((x) => x.key);
  const unshown = lean.filter((x) => x.value !== null && x.shown === false && !trusted(state, x.key)).map((x) => x.key);
  if (state.checksLeft > 0) return { reason: 'check', fields: [] };
  if (miss.length > 0) return { reason: 'miss', fields: miss };
  if (unshown.length > 0) return { reason: 'unshown', fields: unshown };
  return null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const confirm = (s: LeanRunState, key: string) => s.confirmed.set(key, (s.confirmed.get(key) ?? 0) + 1);

function switchToFull(state: LeanRunState, note: string): void {
  if (state.mode === 'full') return;
  state.mode = 'full';
  state.why = 'switched';
  state.note = note;
  console.warn(`[lean] ${note}: the rest of this run takes the full capture`);
}

/** Compares one page read both ways (spec §3.4) and updates the run's state. */
export function learn(state: LeanRunState, lean: FieldReading[], full: FieldReading[], opts: { check: boolean; url: string }): { disagreed: string[]; rescued: string[] } {
  const byKey = new Map(full.map((x) => [x.key, x]));
  const disagreed: string[] = [];
  const rescued: string[] = [];
  for (const l of lean) {
    const f = byKey.get(l.key);
    if (!f) continue;
    if (l.value === null) {
      if (f.value !== null) { rescued.push(l.key); state.confirmed.delete(l.key); }
      else if (l.hasPaths) confirm(state, l.key);
      continue;
    }
    if (!same(l.value, f.value)) { disagreed.push(l.key); continue; }
    if (l.shown === false && f.shown === true) { rescued.push(l.key); state.confirmed.delete(l.key); }
    else if (l.shown === false && f.shown === false) confirm(state, l.key);
    else if (l.shown !== f.shown) disagreed.push(l.key);
  }
  if (opts.check) state.checksLeft = Math.max(0, state.checksLeft - 1);
  state.rescueStreak = rescued.length > 0 ? state.rescueStreak + 1 : 0;
  if (disagreed.length > 0) switchToFull(state, `lean read ${disagreed.join(', ')} differently on ${opts.url}`);
  else if (state.rescueStreak >= LEAN_RESCUE_STREAK) switchToFull(state, `${LEAN_RESCUE_STREAK} products in a row needed the full capture`);
  return { disagreed, rescued };
}

export function recordOutcome(state: LeanRunState, o: LeanOutcome): LeanOutcome {
  // Spec §3.4: an item without a rescue resets the streak, an item written lean included.
  if (o.mode === 'lean') { state.counts.lean++; state.rescueStreak = 0; }
  else if (o.mode === 'full') state.counts.full++;
  else if (o.reason === 'check' || o.reason === 'miss' || o.reason === 'unshown' || o.reason === 'verdict') state.counts.leanFull[o.reason]++;
  return o;
}

export function leanSummary(runId: string, s: LeanRunState): string {
  const lf = s.counts.leanFull;
  const both = lf.check + lf.miss + lf.unshown + lf.verdict;
  const why = s.mode === 'full' ? ` (${s.why}${s.note ? `: ${s.note}` : ''})` : '';
  return `run ${runId}: lean ${s.counts.lean}, lean+full ${both} (check ${lf.check}, miss ${lf.miss}, unshown ${lf.unshown}, verdict ${lf.verdict}), full ${s.counts.full}${why}`;
}
