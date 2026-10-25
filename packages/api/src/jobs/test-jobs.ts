// Registered only with WORKER_TEST_JOBS=1 (the worker's crash-recovery and monitoring tests, the monitoring live
// check): they sleep, hang or throw; they load no page. Their policies are known to the watchdog and ops' Queue view
// (monitoring/attention.ts), so a hanging one reads as silent there.
import type { Registry } from './runner.js';
import type { JobPolicy } from './types.js';

const BG = { lane: 'background', priority: 10, startWithinMs: null } as const;

export const TEST_JOB_POLICIES: Record<string, JobPolicy> = {
  'test-sleep': { ...BG, maxAttempts: 2, stuckMs: 10 * 60_000 },
  'test-sleep-once': { ...BG, maxAttempts: 1, stuckMs: 10 * 60_000 },
  // Never reports progress: silent after 30 s, stopped as stuck at 60 s.
  'test-hang': { ...BG, maxAttempts: 1, stuckMs: 60_000 },
  'test-throw': { ...BG, maxAttempts: 1, stuckMs: 60_000 },
};

/** The message test-throw fails with: a proxy URL with a password, which every report and log line must redact. */
export const TEST_THROW_MESSAGE = 'test-throw: could not reach http://live-user:live-secret@proxy.test:7000';

const sleepJob = (type: string): Registry[string] => ({
  policy: TEST_JOB_POLICIES[type]!,
  run: (p: { ms: number; finishOnAttempt?: number }, ctx) => {
    if (p.finishOnAttempt !== undefined && ctx.attempt >= p.finishOnAttempt) return Promise.resolve({ attempt: ctx.attempt });
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ attempt: ctx.attempt }), p.ms);
      ctx.signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('stopped')); });
    });
  },
});

export function testJobDefinitions(): Registry {
  return {
    'test-sleep': sleepJob('test-sleep'),
    'test-sleep-once': sleepJob('test-sleep-once'),
    'test-hang': {
      policy: TEST_JOB_POLICIES['test-hang']!,
      run: (_p: unknown, ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('stopped')))),
    },
    'test-throw': { policy: TEST_JOB_POLICIES['test-throw']!, run: async () => { throw new Error(TEST_THROW_MESSAGE); } },
  };
}
