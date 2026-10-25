// What a heartbeat and an error report say they run (spec 2026-10-25 monitoring §2.1): the git short sha when a
// checkout is there, else @robot/api's package version (the Docker images carry no .git). Read once.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let cached: string | null = null;

export function serviceVersion(): string {
  if (cached !== null) return cached;
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: fileURLToPath(new URL('.', import.meta.url)), timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (/^[0-9a-f]{7,40}$/.test(sha)) return (cached = sha);
  } catch { /* no git here: the package version */ }
  try {
    cached = String((JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: string }).version ?? 'unknown');
  } catch { cached = 'unknown'; }
  return cached;
}
