// Chromium a dead worker left running (`tsx watch` restarting it on Windows, Task Manager, a crash): every
// browser a worker launches carries `--robot-owner=<the worker's pid>` (@robot/browser's setBrowserOwner),
// so a worker starting up finds the ones whose owner is gone and closes them. Playwright does not expose a
// launched browser's pid, and a hard kill writes no file; the switch on the process's own command line
// survives both. Only browsers of a dead owner are touched: never this worker's, never another live
// worker's (a second worktree, the isolated pair), never a browser without the switch (Marko's own Chrome).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BROWSER_OWNER_SWITCH } from '@robot/browser';

const run = promisify(execFile);

export type OwnedProcess = { pid: number; commandLine: string };

/** The pids among `procs` whose owner (the switch's pid) is neither this process nor alive. */
export function orphansOf(procs: OwnedProcess[], alive: (pid: number) => boolean, self = process.pid): number[] {
  const out: number[] = [];
  for (const p of procs) {
    const at = p.commandLine.indexOf(BROWSER_OWNER_SWITCH);
    if (at < 0) continue;
    const owner = Number.parseInt(p.commandLine.slice(at + BROWSER_OWNER_SWITCH.length), 10);
    if (!Number.isInteger(owner) || owner <= 0 || owner === self || alive(owner)) continue;
    out.push(p.pid);
  }
  return out;
}

export function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Every process whose command line carries the owner switch. */
export async function listOwnedBrowsers(): Promise<OwnedProcess[]> {
  if (process.platform === 'win32') {
    const filter = `CommandLine LIKE '%${BROWSER_OWNER_SWITCH}%'`;
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    const text = stdout.trim();
    if (!text) return [];
    const parsed = JSON.parse(text) as { ProcessId: number; CommandLine: string | null } | Array<{ ProcessId: number; CommandLine: string | null }>;
    return (Array.isArray(parsed) ? parsed : [parsed])
      .filter((p) => p.CommandLine?.includes(BROWSER_OWNER_SWITCH))
      .map((p) => ({ pid: p.ProcessId, commandLine: p.CommandLine! }));
  }
  const { stdout } = await run('ps', ['-eo', 'pid=,args='], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.split('\n').map((line) => line.trim()).filter((line) => line.includes(BROWSER_OWNER_SWITCH))
    .map((line) => { const sp = line.indexOf(' '); return { pid: Number(line.slice(0, sp)), commandLine: line.slice(sp + 1) }; });
}

async function kill(pid: number): Promise<void> {
  if (process.platform === 'win32') await run('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  else { try { process.kill(pid, 'SIGKILL'); } catch { /* gone already */ } }
}

/** Closes the browsers a dead worker left running; returns their pids. Never throws: a failed sweep is logged. */
export async function closeOrphanBrowsers(log: (line: string) => void = (l) => console.log(`[worker] ${l}`)): Promise<number[]> {
  try {
    const orphans = orphansOf(await listOwnedBrowsers(), isAlive);
    for (const pid of orphans) await kill(pid);
    if (orphans.length > 0) log(`closed ${orphans.length} browser process(es) a stopped worker left running`);
    return orphans;
  } catch (err) {
    log(`could not look for browsers a stopped worker left running: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
