// Pure view logic for the Schema tab (spec 5.6). No React, no tRPC.
import type { CellStatus } from '../components/schema-grid';
import type { VerificationResults, VerificationState } from './verification-view';

export type StripState = 'none' | 'editing' | 'active' | 'stalled' | 'failed' | 'results';
export type ColumnState = 'idle' | 'queued' | 'capturing' | 'captured' | 'not_captured';
export type CellLine = { tone: 'pass' | 'fail' | 'stale' | 'not_captured' | 'none'; text: string };

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

/** Per proof page, during and after a run. During `active`, uses the stage text ("capturing 2/3") and the captures map; after, `captured` or `not_captured`. */
export function columnStates(args: { urls: string[]; state: StripState; stage: string | null; captures: Record<string, { captureId?: string; blockedReason?: string }> }): ColumnState[] {
  const { urls, state, stage, captures } = args;
  if (state === 'active') {
    const m = /^capturing (\d+)\/(\d+)/.exec(stage ?? '');
    if (m) {
      const current = Number(m[1]);
      return urls.map((_, i) => (i + 1 < current ? 'captured' : i + 1 === current ? 'capturing' : 'queued'));
    }
    return urls.map(() => (stage ? 'captured' : 'queued'));
  }
  return urls.map((u) => {
    const ref = captures[u];
    if (!ref) return 'idle';
    return ref.captureId ? 'captured' : 'not_captured';
  });
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

/** "Not verified yet · n fields · 3 pages" | "Verifying · about 2 min" | "n of m fields verified · k need attention · j changed since" | ... per spec 5.6. */
export function stripSummary(args: { state: StripState; fieldCount: number; pageCount: number; currentKeys: string[]; failingKeys: string[]; staleKeys: string[]; estimate?: TimeEstimate | null }): string {
  const { state, fieldCount, pageCount, currentKeys, failingKeys, staleKeys, estimate } = args;
  const fields = (n: number) => `${n} field${n === 1 ? '' : 's'}`;
  switch (state) {
    case 'none':
    case 'editing': return `Not verified yet · ${fields(fieldCount)} · ${pageCount} page${pageCount === 1 ? '' : 's'}`;
    // The rough time is the second of the two facts spec 6 allows a separator
    // between; without a loaded estimate there is only one fact to state.
    case 'active': return estimate ? `Verifying · ${roughTime(estimate)}` : 'Verifying';
    case 'stalled': return 'This verification stalled. Run it again.';
    case 'failed': return 'The last verification failed';
    case 'results': {
      const parts = [`${currentKeys.length} of ${fields(fieldCount)} verified`];
      if (failingKeys.length > 0) parts.push(`${failingKeys.length} need${failingKeys.length === 1 ? 's' : ''} attention`);
      if (staleKeys.length > 0) parts.push(`${staleKeys.length} changed since`);
      return parts.join(' · ');
    }
  }
}

/** The reserved second line of an expected cell. `typeFix` is the row's type-fix chip suggestion (spec 5.6): when a not_found cell's typed value looks like a link, the hint names the fix directly rather than the generic "check the value" copy. `pageIndex` is the cell's column (0-based): on pages four to six (index 3+) a blank, unverified cell reads as "not checked" rather than an empty reserved line (spec 2026-09-17 §4). */
export function cellLine(status: CellStatus | null, typed: string, typeFix?: 'url' | null, pageIndex?: number): CellLine {
  // Pages four to six: a blank cell is "not checked here", not an omission (spec 2026-09-17 §4).
  if (!status) return { tone: 'none', text: typed.trim() === '' && (pageIndex ?? 0) >= 3 ? 'not checked' : '' };
  switch (status.status) {
    case 'pass': {
      if (status.found !== undefined && status.found !== typed) return { tone: 'pass', text: `page shows ${status.found}` };
      const layout = status.layout && status.layout > 1 ? ` · layout ${status.layout}` : '';
      return { tone: 'pass', text: (status.pathSource ? `from ${status.pathSource}` : 'verified') + layout };
    }
    case 'fail':
      if (status.reason === 'not_found' && typeFix === 'url') return { tone: 'fail', text: 'Not found as text. It looks like a link: set type to url.' };
      return { tone: 'fail', text: status.hint ?? 'Not found on this page.' };
    case 'stale': return { tone: 'stale', text: 'changed since verified' };
    case 'not_captured': return { tone: 'not_captured', text: 'page not captured' };
  }
}

/** Verify/Re-verify button label + enabled flag. */
export function verifyButton(args: { state: StripState; firstRun: boolean; reverifyCount: number; capturesFresh: boolean; aiAvailable: boolean; upperBoundUsd: number; complete: boolean; busy: boolean }): { label: string; disabled: boolean; reason?: string } {
  const { state, firstRun, reverifyCount, capturesFresh, aiAvailable, upperBoundUsd, complete, busy } = args;
  const cost = aiAvailable ? `up to $${upperBoundUsd.toFixed(2)}` : 'mechanical only';
  if (state === 'active') return { label: firstRun ? 'Verify' : 'Re-verify', disabled: true, reason: 'Verifying' };
  if (!complete) return { label: firstRun ? `Verify · ${cost}` : 'Re-verify', disabled: true, reason: 'Fill in every page and every cell first' };
  if (firstRun) return { label: `Verify · ${cost}`, disabled: busy };
  if (reverifyCount === 0) return { label: 'Everything is verified', disabled: true, reason: 'Nothing has changed since the last verification' };
  const n = `${reverifyCount} field${reverifyCount === 1 ? '' : 's'}`;
  const free = capturesFresh && (!aiAvailable || upperBoundUsd === 0);
  return { label: `Re-verify ${n} · ${free ? 'free' : cost}`, disabled: busy };
}

/** One line for the strip when a field's second layout rests on a single page (spec 2026-09-17 §3). */
export function thinEvidenceNote(results: Record<string, { thinEvidence?: boolean }> | null | undefined, rows: Array<{ key?: string; name: string }>): string | null {
  const names = rows.filter((r) => r.key && results?.[r.key]?.thinEvidence).map((r) => r.name);
  return names.length ? `${names.join(', ')}: second layout proven on one page · add another page of that layout to be sure` : null;
}

const isHttpUrl = (s: string) => { try { return /^https?:$/.test(new URL(s.trim()).protocol); } catch { return false; } };

/** Spec 5.6's type-fix chip: a not_found cell whose typed value is an http(s) URL on a text field. */
export function typeFixSuggestion(row: { type: string; expected: string[] }, cells: Array<CellStatus | null>): 'url' | null {
  if (row.type !== 'text') return null;
  const anyNotFound = cells.some((c) => c?.status === 'fail' && c.reason === 'not_found');
  const anyPass = cells.some((c) => c?.status === 'pass');
  if (!anyNotFound || anyPass) return null;
  return row.expected.every((v) => v.trim() === '' || isHttpUrl(v)) && row.expected.some((v) => isHttpUrl(v)) ? 'url' : null;
}
