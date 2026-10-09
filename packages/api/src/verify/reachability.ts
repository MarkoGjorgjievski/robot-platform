// packages/api/src/verify/reachability.ts
// The shaping behind `sources.reachability`: one free browser visit, reported
// in the same sentence the listing bar and proof cards use (verdict-copy.ts).
import { verdictSentence, type CaptureErrorKind, type CaptureVerdict } from '@robot/browser';

export type Reachability = { verdict: CaptureVerdict | { kind: CaptureErrorKind }; message: string; finalUrl: string | null; ms: number };

/** The free reachability line Add website shows (spec 2026-10-09 §A2). */
export function reachabilityResult(url: string, verdict: Reachability['verdict'], finalUrl: string | null, ms: number): Reachability {
  return { verdict, message: verdictSentence(verdict, url), finalUrl, ms };
}
