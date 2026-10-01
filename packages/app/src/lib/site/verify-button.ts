// Pure view logic for the Verification tab's Verify/Re-verify button. No React, no tRPC.
import type { VerificationResults, VerificationState } from './verification-view';
import type { variantsNeed } from './variants-row-view';

export type StripState = 'none' | 'editing' | 'active' | 'stalled' | 'failed' | 'results';

/** Which strip to show. `results` needs a completed clean run whose `results` are non-empty; `editing` is a never-verified or no-results source. */
export function stripState(args: { verification: VerificationState; results: VerificationResults | null }): StripState {
  switch (args.verification) {
    case 'active': return 'active';
    case 'stalled': return 'stalled';
    case 'failed': return 'failed';
    case 'done': return args.results && Object.keys(args.results).length > 0 ? 'results' : 'editing';
    case 'none': return 'editing';
  }
}

/** What a verification is about to cost in wall-clock time, in the vaguest honest words. */
export type TimeEstimate = { fields: number; aiFields: number; capturesFresh: boolean };

/**
 * Rough wall-clock time for a verification (spec 5.6's "rough time"), deliberately
 * coarse: three captures at ~12s each when the stored ones are stale, plus ~8s per
 * field that has to reach AI. Never a number of seconds — a promise we can keep.
 */
export function roughTime(estimate: TimeEstimate): string {
  const seconds = (estimate.capturesFresh ? 0 : 3 * 12) + estimate.aiFields * 8;
  if (seconds === 0) return 'a few seconds';
  if (seconds < 45) return 'under a minute';
  return `about ${Math.ceil(seconds / 60)} min`;
}

const fieldsWord = (n: number) => `${n} field${n === 1 ? '' : 's'}`;

/**
 * Verify/Re-verify button label + enabled flag (spec 2026-09-25 §2.4):
 * `Verify 8 fields · free` / `Verify 8 fields · up to $X`, and the re-verify
 * form `Re-verify n fields · free | up to $X`. "Free" is about money: with no
 * AI, or no field that could reach it, a run spends nothing. Stale captures
 * cost time (see `roughTime`), never money, so they do not make it priced.
 * `capturesFresh` stays in the arguments for callers that pass the estimate whole.
 *
 * `variants` (plan 2, optional, defaults to `{ kind: 'none' }` — controller
 * ruling R3): when variants are `pending`, the label gains "and variants" (or
 * becomes the variants-only `Verify variants · free` when no field needs a
 * run) — the variant part never costs money (Global Constraints), so it is
 * always said "free" regardless of the fields' own cost. When `blocked`, the
 * button stays enabled for a field run that is still possible and shows the
 * reason beside it; otherwise the reason disables it, same as any other.
 */
export function verifyButton(args: {
  state: StripState; firstRun: boolean; fieldCount: number; reverifyCount: number; capturesFresh: boolean;
  aiAvailable: boolean; upperBoundUsd: number; complete: boolean; busy: boolean;
  variants?: ReturnType<typeof variantsNeed>;
}): { label: string; disabled: boolean; reason?: string } {
  const { state, firstRun, fieldCount, reverifyCount, aiAvailable, upperBoundUsd, complete, busy, variants = { kind: 'none' } } = args;
  const cost = !aiAvailable || upperBoundUsd === 0 ? 'free' : `up to $${upperBoundUsd.toFixed(2)}`;
  const first = `Verify ${fieldsWord(fieldCount)} · ${cost}`;
  if (state === 'active') return { label: firstRun ? 'Verify' : 'Re-verify', disabled: true, reason: 'Verifying' };
  // M7: "Fix the problems listed above first" would only be honest if the problems
  // list were always on screen at this point, but it is gated on `touched`
  // (source-schema.tsx) — false on first paint, before the operator has edited
  // anything or clicked this disabled button once. So this names the actual rule
  // instead of pointing at a list that may not be showing yet: pages four to six
  // may be blank (spec 2026-09-17 — extra pages can go unchecked), but one to
  // three and every cell on them are still required.
  if (!complete) return { label: firstRun ? first : 'Re-verify', disabled: true, reason: 'Fill in pages one to three, and at least one value on each extra page' };

  if (firstRun) {
    if (variants.kind === 'pending') return { label: `Verify ${fieldsWord(fieldCount)} and variants · ${cost}`, disabled: busy };
    if (variants.kind === 'blocked') return { label: first, disabled: busy, reason: variants.reason };
    return { label: first, disabled: busy };
  }

  if (reverifyCount === 0) {
    if (variants.kind === 'pending') return { label: 'Verify variants · free', disabled: busy };
    if (variants.kind === 'blocked') return { label: 'Verify variants · free', disabled: true, reason: variants.reason };
    return { label: 'Everything is verified', disabled: true, reason: 'Nothing has changed since the last verification' };
  }

  if (variants.kind === 'pending') return { label: `Re-verify ${fieldsWord(reverifyCount)} and variants · ${cost}`, disabled: busy };
  if (variants.kind === 'blocked') return { label: `Re-verify ${fieldsWord(reverifyCount)} · ${cost}`, disabled: busy, reason: variants.reason };
  return { label: `Re-verify ${fieldsWord(reverifyCount)} · ${cost}`, disabled: busy };
}
