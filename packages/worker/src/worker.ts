// The worker (spec 2026-10-23 §4.3): the only process with browsers. One gate limits them; the runner
// claims this queue's jobs; with WEBSITE_CHECKS=on, the hourly sweep enqueues due website checks; unless RECURRING_RUNS=off, the minute sweep starts each website's scheduled run.
// Monitoring (spec 2026-10-25): it beats into `workers` every 30 s, answers WORKER_HEALTH_PORT, reports its terminal faults, and its watchdog warns about stuck work every 60 s.
import {
  createBrowserGate, setBrowserGate, startJobRunner, jobRegistry, startWebsiteChecks, enqueueDueWebsiteChecks, startRecurringRuns, mailOn,
  type JobRunner, type WorkerBrowserGate,
} from '@robot/api/jobs';
import { configureErrorReports } from '@robot/api/errors';
import { createLog } from '@robot/api/log';
import { DEAD_WORKER_MS, serviceVersion, startHeartbeat, startWatchdog, type Heartbeat } from '@robot/api/monitoring';
import type { WorkerConfig } from './config.js';
import { startHealthServer, type HealthServer } from './health.js';

export type Worker = { runner: JobRunner; gate: WorkerBrowserGate; heartbeat: Heartbeat; health: { port: number } | null; healthy(): boolean; stop(): Promise<void> };
export type WorkerDeps = { freeMb?: () => number; heartbeatMs?: number; watchEveryMs?: number };

const log = createLog('worker');
/** The longest a stop waits for the heartbeat's last write and its row's removal (the row then ages out as dead). */
const HEARTBEAT_STOP_MS = 3000;

function bounded(p: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms); })])
    .finally(() => clearTimeout(timer));
}

export async function startWorker(config: WorkerConfig, deps: WorkerDeps = {}): Promise<Worker> {
  configureErrorReports({ service: 'worker' });
  const gate = createBrowserGate({ max: config.browsers, minFreeMb: config.minFreeMb, ...(deps.freeMb ? { freeMb: deps.freeMb } : {}) });
  setBrowserGate(gate);
  const runner = startJobRunner({
    queue: config.queue, registry: jobRegistry({ testJobs: config.testJobs }), lanes: config.lanes,
    leaseMs: config.leaseMs, pollMs: config.pollMs, retryBaseMs: config.retryBaseMs, minFreeMb: config.minFreeMb,
    ...(deps.freeMb ? { freeMb: deps.freeMb } : {}), browsers: gate, ...(config.name ? { workerName: config.name } : {}),
  });
  const stopChecks = startWebsiteChecks({ env: { WEBSITE_CHECKS: config.websiteChecks ? 'on' : 'off' }, sweep: () => enqueueDueWebsiteChecks() });
  const stopRecurring = startRecurringRuns({ enabled: config.recurringRuns });
  const heartbeat = startHeartbeat({
    workerId: runner.workerId, queue: config.queue, version: serviceVersion(), ...(deps.heartbeatMs ? { everyMs: deps.heartbeatMs } : {}),
    state: () => ({ browsers: { inUse: gate.open(), max: config.browsers }, lanes: runner.lanes(), websiteChecks: config.websiteChecks, recurringRuns: config.recurringRuns }),
  });
  const stopWatch = startWatchdog({ queue: config.queue, ...(deps.watchEveryMs ? { everyMs: deps.watchEveryMs } : {}) });
  let stopping = false;
  const startedAt = Date.now();
  // Spec 2026-10-25 §2.1: working = started, not stopping, and its database answered a beat in the last 2 minutes.
  const healthy = () => !stopping && Date.now() - (heartbeat.lastBeatAt() ?? startedAt) < DEAD_WORKER_MS;
  let health: HealthServer | null = null;
  if (config.healthPort !== null) {
    try {
      health = await startHealthServer({ port: config.healthPort, healthy });
    } catch (err) {
      // Monitoring never stops the work (spec §3.2): no health port, the worker runs on.
      log.error('the health port could not be opened; running without it', { port: config.healthPort, error: err });
    }
  }
  log.info(`${runner.workerId} on queue "${config.queue}": browsers ${config.browsers}; lanes interactive ${config.lanes.interactive}, background ${config.lanes.background}, runs ${config.lanes.runs}; min free memory ${config.minFreeMb} MB; website checks ${config.websiteChecks ? 'on (hourly)' : 'off'}; recurring runs ${config.recurringRuns ? 'on (every minute)' : 'off'}; mail ${mailOn() ? 'on' : 'off'}; health ${health ? `127.0.0.1:${health.port}` : 'off'}`,
    { workerId: runner.workerId, queue: config.queue, version: serviceVersion() });
  let stopped: Promise<void> | null = null;
  return {
    runner, gate, heartbeat, health: health ? { port: health.port } : null, healthy,
    stop() {
      // Once: a second call (SIGINT during a stop-file stop) waits for the first.
      stopped ??= (async () => {
        stopping = true;
        stopChecks();
        stopRecurring();
        stopWatch();
        try {
          await runner.stop(config.shutdownMs);
          await gate.closeAll();
          setBrowserGate(null);
        } finally {
          // Even when the runner or the gate throws: the row goes (or is left to age out) and the port closes, so a
          // library caller's process is not held open. A hung database holds the stop at most HEARTBEAT_STOP_MS.
          try { await bounded(heartbeat.stop(), HEARTBEAT_STOP_MS); } catch (err) { log.warn('the heartbeat did not stop cleanly', { error: err }); }
          try { await health?.close(); } catch (err) { log.warn('the health port did not close cleanly', { error: err }); }
        }
        log.info(`${runner.workerId} stopped`, { workerId: runner.workerId });
      })();
      return stopped;
    },
  };
}
