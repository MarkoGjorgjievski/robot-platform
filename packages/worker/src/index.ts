// @robot/worker — `pnpm dev:all` starts it (turbo `dev`). Stops on SIGINT/SIGTERM/SIGBREAK, or when WORKER_STOP_FILE
// appears (Windows, where a smoke pair's worker cannot be sent a signal it can catch): it stops claiming,
// gives running jobs back, closes its browsers and exits 0.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { existsSync, rmSync } from 'node:fs';

const here = fileURLToPath(new URL('.', import.meta.url));
try {
  loadEnvFile(join(here, '..', '..', '..', '.env'));
} catch {
  // no .env: whatever is in process.env
}
// Spec 2026-10-25 monitoring §2.4: an unhandled rejection is reported; an uncaught exception is reported, then exits 1.
const { installProcessHandlers } = await import('@robot/api/errors');
installProcessHandlers('worker');
// The api-server serves capture files from its public/captures; the worker writes them there (Docker: a shared volume).
process.env.CAPTURES_DIR ??= join(here, '..', '..', 'api-server', 'public', 'captures');

const { readWorkerConfig } = await import('./config.js');
const { startWorker } = await import('./worker.js');
const { closeOrphanBrowsers } = await import('./orphans.js');
const { setBrowserOwner } = await import('@robot/browser');
const config = readWorkerConfig(process.env);
// Every browser this worker launches names it, so the next start can close what a hard kill (a `tsx watch`
// restart on Windows, Task Manager) left running; this start closes what an earlier worker left.
setBrowserOwner(String(process.pid));
await closeOrphanBrowsers();
// A stop file left over from an earlier stop would stop this worker at once.
if (config.stopFile) rmSync(config.stopFile, { force: true });
const worker = await startWorker(config);

let stopping = false;
async function shutdown(why: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] stopping (${why})`);
  try {
    await worker.stop();
  } catch (err) {
    console.error('[worker] stop failed:', err);
    process.exit(1);
  }
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
// Windows: Ctrl+Break, and what some process managers send in place of SIGTERM.
process.on('SIGBREAK', () => void shutdown('SIGBREAK'));
if (config.stopFile) {
  const file = config.stopFile;
  setInterval(() => { if (existsSync(file)) { rmSync(file, { force: true }); void shutdown('stop file'); } }, 500);
}
