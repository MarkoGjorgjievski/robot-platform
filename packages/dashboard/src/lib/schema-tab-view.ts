// Pure view logic for the Schema tab (spec 5.6). No React, no tRPC.
import type { CellStatus } from '../components/schema-grid';
import type { VerificationResults, VerificationState } from './verification-view';

export type StripState = 'none' | 'editing' | 'active' | 'stalled' | 'failed' | 'results';
export type ColumnState = 'idle' | 'queued' | 'capturing' | 'captured' | 'not_captured';
export type CellLine = { tone: 'pass' | 'fail' | 'stale' | 'not_captured' | 'none'; text: string };

/** Which strip to show. `results` needs a completed clean run whose `results` are non-empty; `editing` is a never-verified or dirty-with-no-results source. */
export function stripState(args: { verification: VerificationState; results: VerificationResults | null; dirty: boolean }): StripState {
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

/** "Not verified yet · n fields · 3 pages" | "Verifying" | "n of m fields verified · k need attention · j changed since" | ... per spec 5.6. */
export function stripSummary(args: { state: StripState; fieldCount: number; pageCount: number; currentKeys: string[]; failingKeys: string[]; staleKeys: string[] }): string {
  const { state, fieldCount, pageCount, currentKeys, failingKeys, staleKeys } = args;
  const fields = (n: number) => `${n} field${n === 1 ? '' : 's'}`;
  switch (state) {
    case 'none':
    case 'editing': return `Not verified yet · ${fields(fieldCount)} · ${pageCount} page${pageCount === 1 ? '' : 's'}`;
    case 'active': return 'Verifying';
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

/** The reserved second line of an expected cell. */
export function cellLine(status: CellStatus | null, typed: string): CellLine {
  if (!status) return { tone: 'none', text: '' };
  switch (status.status) {
    case 'pass':
      if (status.found !== undefined && status.found !== typed) return { tone: 'pass', text: `page shows ${status.found}` };
      return { tone: 'pass', text: status.pathSource ? `from ${status.pathSource}` : 'verified' };
    case 'fail': return { tone: 'fail', text: status.hint ?? 'Not found on this page.' };
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

const isHttpUrl = (s: string) => { try { return /^https?:$/.test(new URL(s.trim()).protocol); } catch { return false; } };

/** Spec 5.6's type-fix chip: a not_found cell whose typed value is an http(s) URL on a text field. */
export function typeFixSuggestion(row: { type: string; expected: string[] }, cells: Array<CellStatus | null>): 'url' | null {
  if (row.type !== 'text') return null;
  const anyNotFound = cells.some((c) => c?.status === 'fail' && c.reason === 'not_found');
  const anyPass = cells.some((c) => c?.status === 'pass');
  if (!anyNotFound || anyPass) return null;
  return row.expected.every((v) => v.trim() === '' || isHttpUrl(v)) && row.expected.some((v) => isHttpUrl(v)) ? 'url' : null;
}
