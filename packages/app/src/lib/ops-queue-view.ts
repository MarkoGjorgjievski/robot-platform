// The ops Queue view (spec 2026-10-25 monitoring §2.5): staff only. Pure. Mirrors `ops.queue`'s answer (the app's
// views re-declare the api's shapes, like ops-orgs-view.ts).
export type QueueLane = 'interactive' | 'background' | 'runs';
export type QueueWorker = {
  id: string; queue: string; version: string | null; startedAt: Date; beatAt: Date; beatAgeMs: number; dead: boolean;
  browsers: { inUse: number; max: number }; lanes: Partial<Record<QueueLane, number>>; websiteChecks: boolean; recurringRuns: boolean;
};
export type QueueTypeRow = { type: string; queued: number; running: number; done: number; failed: number; oldestQueuedMs: number | null; longestRunningMs: number | null };
export type QueueAttention = {
  kind: 'backlog' | 'silent' | 'dead-worker'; jobId: string; type: string; lane: QueueLane | null; ageMs: number; workerId: string | null;
  sourceId: string | null; websiteName: string | null; runId: string | null; lastError: string | null;
};
export type QueueFailure = { jobId: string; type: string; attempts: number; maxAttempts: number; error: string | null; finishedAt: Date | null; agoMs: number | null };
export type QueueOverview = { queue: string; workers: QueueWorker[]; types: QueueTypeRow[]; attention: QueueAttention[]; failures: QueueFailure[] };

export const QUEUE_REFRESH_MS = 15_000;
/** A beat older than this reads red: the worker has stopped answering (spec §2.1's 2 minutes). */
export const STALE_BEAT_MS = 120_000;
export const WORKERS_EMPTY = 'No worker has beaten in the last day. Nothing on this queue is being run.';
export const TYPES_EMPTY = 'No jobs on this queue in the last day.';
export const ATTENTION_EMPTY = 'Nothing needs attention.';
export const FAILURES_EMPTY = 'No failed jobs.';
export const ATTENTION_LABELS = {
  backlog: 'Waiting, nobody is taking it',
  silent: 'Running, no progress',
  'dead-worker': 'Its worker stopped answering',
} as const;
const LANES: QueueLane[] = ['interactive', 'background', 'runs'];

export function durationText(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

export function workerRowsView(workers: readonly QueueWorker[], thisQueue: string) {
  return workers.map((w) => ({
    id: w.id, queue: w.queue, thisQueue: w.queue === thisQueue, version: w.version ?? '—',
    beatLabel: `${durationText(w.beatAgeMs)} ago`, stale: w.dead || w.beatAgeMs > STALE_BEAT_MS,
    browsersLabel: `${w.browsers.inUse} / ${w.browsers.max}`,
    lanesLabel: LANES.map((l) => `${l} ${w.lanes[l] ?? 0}`).join(' · '),
    switchesLabel: `checks ${w.websiteChecks ? 'on' : 'off'} · schedules ${w.recurringRuns ? 'on' : 'off'}`,
  }));
}

export function typeRowsView(types: readonly QueueTypeRow[]) {
  return types.map((t) => ({
    type: t.type, queued: String(t.queued), running: String(t.running), done: String(t.done), failed: String(t.failed),
    oldestLabel: durationText(t.oldestQueuedMs), longestLabel: durationText(t.longestRunningMs),
  }));
}

export function attentionRowsView(items: readonly QueueAttention[]) {
  return items.map((i) => ({
    key: `${i.kind}:${i.jobId}`, label: ATTENTION_LABELS[i.kind], type: i.type, ageLabel: durationText(i.ageMs), job: i.jobId.slice(0, 8),
    website: i.sourceId ? { sourceId: i.sourceId, name: i.websiteName ?? i.sourceId.slice(0, 8) } : null,
    run: i.runId ? `run ${i.runId.slice(0, 8)}` : null, worker: i.workerId ?? '—', error: i.lastError ?? '—',
  }));
}

export function failureRowsView(failures: readonly QueueFailure[]) {
  return failures.map((f) => ({
    key: f.jobId, type: f.type, attemptsLabel: `${f.attempts} of ${f.maxAttempts}`, error: f.error ?? '—',
    finishedLabel: f.agoMs === null ? '—' : `${durationText(f.agoMs)} ago`,
  }));
}
