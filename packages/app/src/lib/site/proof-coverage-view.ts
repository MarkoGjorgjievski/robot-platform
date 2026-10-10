// What the Verification tab says about the proof-page coverage check (spec
// 2026-10-10 §A5, §5): the stage line and the line under a field's row. Pure,
// so the exact copy is tested without a server. The app never imports
// @robot/api; the query's shape is re-declared here, narrowed.
//
// Distinct from `coverage-view.ts` — that one is the run page's cell-fill
// coverage (a run's field fill-gaps); this is a website's proof-page
// sampling check. Two unrelated "coverage" concepts; this file is only this one.
export type ProofCoverageView = {
  status: 'running' | 'done' | 'failed';
  stage: string | null;
  fields: Array<{ key: string; empty: string[]; sampled: number; explanation: string | null; representative: string | null }>;
};

export const AT_LIMIT = 'This website has its six proof pages';
export const ON_BOARD = 'already a proof page';

/**
 * The line under a field's row. `onBoard`: the representative is already one of
 * the board's cards (the sampler compares addresses loosely), so there is
 * nothing to add — the line says so instead of offering "Use as proof page".
 */
export function coverageLine(f: ProofCoverageView['fields'][number], atLimit: boolean, onBoard = false): { text: string; useAsProofPage: string | null } {
  const parts = [`Empty on ${f.empty.length} of ${f.sampled} sampled ${f.sampled === 1 ? 'product' : 'products'}`];
  if (f.explanation) parts.push(f.explanation);
  if (onBoard) parts.push(ON_BOARD);
  else if (atLimit) parts.push(AT_LIMIT);
  return { text: parts.join(' · '), useAsProofPage: atLimit || onBoard ? null : f.representative };
}

/** The verify bar's one stage line: a running Verify's own stage first, else the coverage check's. */
export function coverageStage(verifyStage: string | null, coverage: ProofCoverageView | null): string | null {
  return verifyStage ?? coverage?.stage ?? null;
}
