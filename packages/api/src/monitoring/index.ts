// What the worker and the api-server need for monitoring (spec 2026-10-25): the heartbeat, the watchdog, readiness.
export { startHeartbeat, DEAD_WORKER_MS, HEARTBEAT_MS, type Heartbeat, type WorkerState } from './heartbeat.js';
export { serviceVersion } from './version.js';
