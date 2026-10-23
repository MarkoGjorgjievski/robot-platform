// Chromium a dead worker left running is closed when the next worker starts; nothing else is touched.
import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orphansOf, listOwnedBrowsers, closeOrphanBrowsers, isAlive, parseOwnedBrowsers } from './orphans.js';

describe('parseOwnedBrowsers', () => {
  // PowerShell 5.1's ConvertTo-Json leaves a raw control character in a command line unescaped: invalid JSON, so
  // a strict parse threw and the sweep found nothing (seen on this machine while measuring, Task 1 of run speed).
  it('reads PowerShell output whose command line holds a raw control character', () => {
    const stdout = '[{"ProcessId":11,"CommandLine":"chrome.exe --robot-owner=100 --title=a\tb\u0001c"},'
      + '{"ProcessId":12,"CommandLine":null},{"ProcessId":13,"CommandLine":"chrome.exe --type=renderer"}]\r\n';
    expect(() => JSON.parse(stdout)).toThrow();
    const procs = parseOwnedBrowsers(stdout);
    expect(procs.map((p) => p.pid)).toEqual([11]);
    expect(procs[0].commandLine).toContain('--robot-owner=100');
  });
  it('reads a single process (an object, not an array) and empty output', () => {
    expect(parseOwnedBrowsers('{"ProcessId":7,"CommandLine":"chrome.exe --robot-owner=5"}')).toEqual([{ pid: 7, commandLine: 'chrome.exe --robot-owner=5' }]);
    expect(parseOwnedBrowsers('  \r\n')).toEqual([]);
  });
});

describe('orphansOf', () => {
  const procs = [
    { pid: 11, commandLine: 'chrome.exe --headless --robot-owner=100 --no-sandbox' },
    { pid: 12, commandLine: 'chrome.exe --robot-owner=200' },
    { pid: 13, commandLine: 'chrome.exe --robot-owner=300' },
    { pid: 14, commandLine: 'chrome.exe --type=renderer' },
    { pid: 15, commandLine: 'chrome.exe --robot-owner=nonsense' },
  ];
  it('only the browsers of an owner that is gone: never this process\'s, a live one\'s, or one with no owner', () => {
    expect(orphansOf(procs, (pid) => pid === 200, 300)).toEqual([11]);
  });
});

describe('closeOrphanBrowsers (a real Chromium)', () => {
  const profiles = mkdtempSync(join(tmpdir(), 'worker-orphans-'));
  const started: ChildProcess[] = [];
  afterAll(() => {
    for (const c of started) if (c.exitCode === null) c.kill('SIGKILL');
    rmSync(profiles, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const chromiumPath = (): string => (createRequire(import.meta.resolve('@robot/browser'))('playwright') as { chromium: { executablePath(): string } }).chromium.executablePath();
  /** A headless Chromium carrying `--robot-owner=<owner>`, as one a worker launched would. */
  const plant = (owner: number, profile: string) => {
    const c = spawn(chromiumPath(), ['--headless=new', `--user-data-dir=${join(profiles, profile)}`, `--robot-owner=${owner}`, 'about:blank'], { stdio: 'ignore', detached: true });
    started.push(c);
    return c;
  };
  const owned = async (owner: number) => (await listOwnedBrowsers()).filter((p) => p.commandLine.includes(`--robot-owner=${owner} `) || p.commandLine.endsWith(`--robot-owner=${owner}`));
  const until = async (pred: () => Promise<boolean>, ms = 20_000) => {
    const t = Date.now() + ms;
    while (!(await pred())) { if (Date.now() > t) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 200)); }
  };

  it('closes a browser whose worker is gone, and leaves a live worker\'s alone', async () => {
    // A worker that has exited: its pid names no live process.
    const gone = spawn(process.execPath, ['-e', '0']);
    await new Promise((r) => gone.once('exit', r));
    expect(isAlive(gone.pid!)).toBe(false);
    plant(gone.pid!, 'orphan');
    plant(process.ppid, 'live');                        // a live owner (this test's parent process)
    await until(async () => (await owned(gone.pid!)).length > 0 && (await owned(process.ppid)).length > 0);

    const closed = await closeOrphanBrowsers(() => {});
    expect(closed.length).toBeGreaterThan(0);
    await until(async () => (await owned(gone.pid!)).length === 0);
    expect((await owned(process.ppid)).length).toBeGreaterThan(0);
  });
});
