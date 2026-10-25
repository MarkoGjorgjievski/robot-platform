import { describe, expect, it } from 'vitest';
import {
  ATTENTION_LABELS, attentionRowsView, durationText, failureRowsView, typeRowsView, workerRowsView,
  type QueueAttention, type QueueFailure, type QueueTypeRow, type QueueWorker,
} from './ops-queue-view';

const worker = (over: Partial<QueueWorker> = {}): QueueWorker => ({
  id: 'host:12:abcd1234', queue: 'default', version: 'a27d292', startedAt: new Date('2026-10-25T10:00:00Z'), beatAt: new Date('2026-10-25T12:00:00Z'),
  beatAgeMs: 12_000, dead: false, browsers: { inUse: 1, max: 3 }, lanes: { interactive: 1, background: 0 }, websiteChecks: true, recurringRuns: false, ...over,
});

describe('the ops Queue view (spec 2026-10-25 monitoring §2.5)', () => {
  it('reads durations short', () => {
    expect([null, Number.NaN, 400, 12_000, 59_499, 61_000, 3 * 3_600_000, 3 * 3_600_000 + 5 * 60_000, 50 * 3_600_000].map(durationText))
      .toEqual(['—', '—', '0 s', '12 s', '59 s', '1 min', '3 h', '3 h 5 min', '2 d']);
  });

  it('labels each worker; a beat past 2 minutes is stale', () => {
    expect(workerRowsView([worker()], 'default')[0]).toEqual({
      id: 'host:12:abcd1234', queue: 'default', thisQueue: true, version: 'a27d292', beatLabel: '12 s ago', stale: false,
      browsersLabel: '1 / 3', lanesLabel: 'interactive 1 · background 0 · runs 0', switchesLabel: 'checks on · schedules off',
    });
    expect(workerRowsView([worker({ beatAgeMs: 121_000, version: null, queue: 'isolated-4100' })], 'default')[0]).toMatchObject({ stale: true, version: '—', thisQueue: false, beatLabel: '2 min ago' });
    expect(workerRowsView([worker({ dead: true, beatAgeMs: 1000 })], 'default')[0]!.stale).toBe(true);
  });

  it('labels jobs by type, attention items with their website and run, and failures', () => {
    const t: QueueTypeRow = { type: 'verify', queued: 2, running: 1, done: 10, failed: 1, oldestQueuedMs: 700_000, longestRunningMs: null };
    expect(typeRowsView([t])[0]).toEqual({ type: 'verify', queued: '2', running: '1', done: '10', failed: '1', oldestLabel: '11 min', longestLabel: '—' });
    const a: QueueAttention = { kind: 'silent', jobId: '0f1e2d3c-0000-4000-8000-000000000001', type: 'run', lane: 'runs', ageMs: 600_000, workerId: 'host:1:a', sourceId: '11111111-0000-4000-8000-000000000001', websiteName: 'Lamps', runId: '22222222-0000-4000-8000-000000000002', lastError: null };
    expect(attentionRowsView([a])[0]).toEqual({
      key: 'silent:0f1e2d3c-0000-4000-8000-000000000001', label: ATTENTION_LABELS.silent, type: 'run', ageLabel: '10 min', job: '0f1e2d3c',
      website: { sourceId: '11111111-0000-4000-8000-000000000001', name: 'Lamps' }, run: 'run 22222222', worker: 'host:1:a', error: '—',
    });
    expect(attentionRowsView([{ ...a, sourceId: null, websiteName: null, runId: null, workerId: null, lastError: 'stalled' }])[0]).toMatchObject({ website: null, run: null, worker: '—', error: 'stalled' });
    expect(ATTENTION_LABELS).toEqual({ backlog: 'Waiting, nobody is taking it', silent: 'Running, no progress', 'dead-worker': 'Its worker stopped answering' });
    const f: QueueFailure = { jobId: 'j1', type: 'verify', attempts: 2, maxAttempts: 2, error: 'stalled', finishedAt: new Date(), agoMs: 90_000 };
    expect(failureRowsView([f, { ...f, jobId: 'j2', error: null, agoMs: null }])).toEqual([
      { key: 'j1', type: 'verify', attemptsLabel: '2 of 2', error: 'stalled', finishedLabel: '1 min ago' },
      { key: 'j2', type: 'verify', attemptsLabel: '2 of 2', error: '—', finishedLabel: '—' },
    ]);
  });
});
