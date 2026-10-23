// Registered only with WORKER_TEST_JOBS=1 (the worker's crash-recovery test): they sleep, load no page.
import type { Registry } from './runner.js';

const sleepJob = (maxAttempts: number): Registry[string] => ({
  policy: { lane: 'background', priority: 10, maxAttempts, stuckMs: 10 * 60_000, startWithinMs: null },
  run: (p: { ms: number; finishOnAttempt?: number }, ctx) => {
    if (p.finishOnAttempt !== undefined && ctx.attempt >= p.finishOnAttempt) return Promise.resolve({ attempt: ctx.attempt });
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ attempt: ctx.attempt }), p.ms);
      ctx.signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('stopped')); });
    });
  },
});

export function testJobDefinitions(): Registry {
  return { 'test-sleep': sleepJob(2), 'test-sleep-once': sleepJob(1) };
}
