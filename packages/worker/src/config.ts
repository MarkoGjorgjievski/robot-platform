// The worker's knobs (spec 2026-10-23 §4.3, §8). Unset or nonsense: the default.
export type WorkerConfig = {
  queue: string; name: string | null; browsers: number;
  lanes: { interactive: number; background: number; runs: number };
  minFreeMb: number; leaseMs: number; pollMs: number; shutdownMs: number; retryBaseMs: number;
  websiteChecks: boolean; testJobs: boolean; stopFile: string | null;
};

type Env = Record<string, string | undefined>;
const int = (env: Env, name: string, fallback: number, min: number): number => {
  const raw = (env[name] ?? '').trim();
  const n = Number(raw);
  return raw !== '' && Number.isInteger(n) && n >= min ? n : fallback;
};
const text = (env: Env, name: string): string | null => { const v = (env[name] ?? '').trim(); return v === '' ? null : v; };

export function readWorkerConfig(env: Env): WorkerConfig {
  return {
    queue: text(env, 'JOB_QUEUE') ?? 'default',
    name: text(env, 'WORKER_NAME'),
    browsers: int(env, 'WORKER_BROWSERS', 3, 1),
    lanes: { interactive: int(env, 'WORKER_INTERACTIVE', 3, 0), background: int(env, 'WORKER_CONCURRENCY', 2, 0), runs: int(env, 'WORKER_RUNS', 1, 0) },
    minFreeMb: int(env, 'WORKER_MIN_FREE_MB', 1024, 0),
    leaseMs: int(env, 'WORKER_LEASE_MS', 60_000, 1000),
    pollMs: int(env, 'WORKER_POLL_MS', 500, 10),
    shutdownMs: int(env, 'WORKER_SHUTDOWN_MS', 25_000, 0),
    retryBaseMs: int(env, 'WORKER_RETRY_MS', 30_000, 1),
    websiteChecks: (env.WEBSITE_CHECKS ?? '').trim().toLowerCase() === 'on',
    testJobs: (env.WORKER_TEST_JOBS ?? '').trim() === '1',
    stopFile: text(env, 'WORKER_STOP_FILE'),
  };
}
