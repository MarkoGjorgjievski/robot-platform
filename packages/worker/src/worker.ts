// The worker (spec 2026-10-23 §4.3): the only process with browsers. One gate limits them; the runner
// claims this queue's jobs; with WEBSITE_CHECKS=on, the hourly sweep enqueues due website checks.
import {
  createBrowserGate, setBrowserGate, startJobRunner, jobRegistry, startWebsiteChecks, enqueueDueWebsiteChecks,
  type JobRunner, type WorkerBrowserGate,
} from '@robot/api/jobs';
import type { WorkerConfig } from './config.js';

export type Worker = { runner: JobRunner; gate: WorkerBrowserGate; stop(): Promise<void> };

export async function startWorker(config: WorkerConfig, deps: { freeMb?: () => number } = {}): Promise<Worker> {
  const gate = createBrowserGate({ max: config.browsers, minFreeMb: config.minFreeMb, ...(deps.freeMb ? { freeMb: deps.freeMb } : {}) });
  setBrowserGate(gate);
  const runner = startJobRunner({
    queue: config.queue, registry: jobRegistry({ testJobs: config.testJobs }), lanes: config.lanes,
    leaseMs: config.leaseMs, pollMs: config.pollMs, retryBaseMs: config.retryBaseMs, minFreeMb: config.minFreeMb,
    ...(deps.freeMb ? { freeMb: deps.freeMb } : {}), browsers: gate, ...(config.name ? { workerName: config.name } : {}),
  });
  const stopChecks = startWebsiteChecks({ env: { WEBSITE_CHECKS: config.websiteChecks ? 'on' : 'off' }, sweep: () => enqueueDueWebsiteChecks() });
  console.log(`[worker] ${runner.workerId} on queue "${config.queue}": browsers ${config.browsers}; lanes interactive ${config.lanes.interactive}, background ${config.lanes.background}, runs ${config.lanes.runs}; min free memory ${config.minFreeMb} MB; website checks ${config.websiteChecks ? 'on (hourly)' : 'off'}`);
  let stopped: Promise<void> | null = null;
  return {
    runner, gate,
    stop() {
      // Once: a second call (SIGINT during a stop-file stop) waits for the first.
      stopped ??= (async () => {
        stopChecks();
        await runner.stop(config.shutdownMs);
        await gate.closeAll();
        setBrowserGate(null);
      })();
      return stopped;
    },
  };
}
