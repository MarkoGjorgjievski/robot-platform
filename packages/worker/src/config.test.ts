import { describe, it, expect } from 'vitest';
import { readWorkerConfig } from './config.js';

describe('readWorkerConfig', () => {
  it('the spec defaults', () => {
    expect(readWorkerConfig({})).toEqual({
      queue: 'default', name: null, browsers: 3, lanes: { interactive: 3, background: 2, runs: 1 }, minFreeMb: 1024,
      leaseMs: 60_000, pollMs: 500, shutdownMs: 25_000, retryBaseMs: 30_000, websiteChecks: false, recurringRuns: true, testJobs: false, stopFile: null, healthPort: null,
    });
  });
  it('reads every knob; nonsense falls back to the default', () => {
    const c = readWorkerConfig({ JOB_QUEUE: 'isolated-4100', WORKER_NAME: 'w1', WORKER_BROWSERS: '1', WORKER_INTERACTIVE: '2', WORKER_CONCURRENCY: '4', WORKER_RUNS: '0',
      WORKER_MIN_FREE_MB: '512', WORKER_LEASE_MS: '2000', WORKER_POLL_MS: 'x', WORKER_SHUTDOWN_MS: '-1', WORKER_RETRY_MS: '100', WEBSITE_CHECKS: 'on', RECURRING_RUNS: 'off', WORKER_TEST_JOBS: '1', WORKER_STOP_FILE: 'C:/tmp/stop', WORKER_HEALTH_PORT: '4001' });
    expect(c).toEqual({ queue: 'isolated-4100', name: 'w1', browsers: 1, lanes: { interactive: 2, background: 4, runs: 0 }, minFreeMb: 512,
      leaseMs: 2000, pollMs: 500, shutdownMs: 25_000, retryBaseMs: 100, websiteChecks: true, recurringRuns: false, testJobs: true, stopFile: 'C:/tmp/stop', healthPort: 4001 });
  });
  it('at least one browser', () => { expect(readWorkerConfig({ WORKER_BROWSERS: '0' }).browsers).toBe(3); });
  it('RECURRING_RUNS: on unless off', () => {
    expect(readWorkerConfig({ RECURRING_RUNS: 'on' }).recurringRuns).toBe(true);
    expect(readWorkerConfig({ RECURRING_RUNS: ' Off ' }).recurringRuns).toBe(false);
  });
  it('WORKER_HEALTH_PORT: 0–65535 (0 = any free port), anything else is off', () => {
    expect(readWorkerConfig({ WORKER_HEALTH_PORT: '0' }).healthPort).toBe(0);
    for (const v of ['', 'x', '-1', '70000', '40.5']) expect(readWorkerConfig({ WORKER_HEALTH_PORT: v }).healthPort).toBeNull();
  });
});
