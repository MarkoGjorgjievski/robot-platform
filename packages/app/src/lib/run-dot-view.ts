/**
 * The run status dot — spec §4, "the one memorable thing": grey idle, pulsing
 * white running, green done, red failed, amber partial, carried everywhere a
 * run is mentioned so "is anything running" is answerable at a glance.
 *
 * This module is the mapping only, kept pure so it can be tested without a
 * browser. The circle itself is `components/run-dot.tsx`.
 */

export const RUN_DOT_STATES = ['idle', 'running', 'done', 'failed', 'partial'] as const;

export type RunDotStatus = (typeof RUN_DOT_STATES)[number];

/** Anything the engine hands us that describes a run. `status` is a free string in the schema. */
export type RunLike = { status?: string | null; completedAt?: Date | null } | null | undefined;

/**
 * `runs.status` is a varchar, not an enum, and the engine writes a wider
 * vocabulary than the dot has colours. The real values, taken from the writers
 * in @robot/api and @robot/scraper: pending, planned, planning, extracting,
 * running, cancelling, completed, failed, partial, cancelled — plus `done`,
 * which run items use and which reads the same way here.
 */
const TERMINAL: Record<string, RunDotStatus> = {
  completed: 'done',
  done: 'done',
  failed: 'failed',
  error: 'failed',
  partial: 'partial',
};

/** Statuses that mean work is queued or moving. `planned` counts: the run exists and is owed an execution. */
const IN_FLIGHT = new Set(['running', 'planned', 'planning', 'executing', 'extracting', 'pending', 'cancelling']);

export function runDotState(run: RunLike): RunDotStatus {
  if (!run) return 'idle';
  const status = (run.status ?? '').trim().toLowerCase();
  if (!status) return 'idle';

  const terminal = TERMINAL[status];
  if (terminal) return terminal;

  if (IN_FLIGHT.has(status)) {
    // The pulse is a promise that something is moving. A run still marked
    // `extracting` but carrying a `completedAt` has no loop behind it — the
    // api-server was restarted mid-run, say (@robot/dashboard's run-progress.ts
    // documents the state) — and a dot pulsing forever there is a lie the
    // customer cannot clear. Grey is the honest answer: nothing is running.
    return run.completedAt ? 'idle' : 'running';
  }

  // `cancelled`, and anything a later engine version invents: a stopped run is
  // not a result, and guessing a colour for an unknown word would be worse than
  // saying nothing.
  return 'idle';
}

const LABELS: Record<RunDotStatus, string> = {
  idle: 'Idle',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  partial: 'Partial',
};

/** The state word — the dot's `aria-label` and its tooltip. */
export function runDotLabel(state: RunDotStatus): string {
  return LABELS[state];
}
