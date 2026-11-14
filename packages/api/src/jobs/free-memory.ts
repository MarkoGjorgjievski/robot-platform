// packages/api/src/jobs/free-memory.ts
// Memory the worker can still use, in MB, for the free-memory floor (`WORKER_MIN_FREE_MB`).
//
// `os.freemem()` is right on Linux (libuv reads MemAvailable) but not on macOS, where it counts only
// the kernel's never-used pages: a Mac with gigabytes reclaimable reads ~100 MB "free" and the
// worker never claims a job (every Find products and Verify waited out its ceiling and answered
// "We couldn't open a browser", 2026-11-11). On macOS it adds the pages the kernel hands back on
// demand — inactive (file cache) and speculative — the way Activity Monitor's pressure reads it.
import os from 'node:os';
import { execFileSync } from 'node:child_process';

/** The pages `vm_stat` prints that macOS reclaims without swapping, plus the free ones. */
const AVAILABLE_PAGES = ['Pages free', 'Pages inactive', 'Pages speculative'];

/** Available MB from `vm_stat`'s output; null when it cannot be read. Exported for the test. */
export function parseVmStat(text: string): number | null {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  if (!Number.isFinite(pageSize) || pageSize <= 0) return null;
  let pages = 0;
  for (const label of AVAILABLE_PAGES) {
    const m = new RegExp(`^${label}:\\s+(\\d+)\\.?$`, 'm').exec(text);
    if (!m) return null;
    pages += Number(m[1]);
  }
  return (pages * pageSize) / 1_048_576;
}

/** The lane loops ask about once a second each; one `vm_stat` (a few ms) serves them for 5 s. */
const CACHE_MS = 5_000;
let cached: { at: number; mb: number } | null = null;

/** Free memory in MB as the worker should count it on this platform. Never throws. */
export function availableMemoryMb(): number {
  const fallback = os.freemem() / 1_048_576;
  if (process.platform !== 'darwin') return fallback;
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.mb;
  let mb = fallback;
  try {
    mb = Math.max(parseVmStat(execFileSync('vm_stat', { encoding: 'utf8', timeout: 2_000 })) ?? fallback, fallback);
  } catch {
    // No vm_stat (a sandbox): the plain reading stands.
  }
  cached = { at: now, mb };
  return mb;
}
