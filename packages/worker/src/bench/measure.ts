// What the benchmark measures (spec 2026-10-23 run speed §5.2): wall time, per-item cycle time, capture timings
// and modes from `captures.metadata`, peak memory of the bench's own Chromium, and every written value.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { asc, eq, inArray } from 'drizzle-orm';
import { db, runs, runItems, extractions, captures, jobs } from '@robot/db';
import { BROWSER_OWNER_SWITCH } from '@robot/browser';
import { product, renderedTruth } from './fixture-shop.js';
import type { SeededSite } from './seed.js';

const run = promisify(execFile);
type Proc = { pid: number; ppid: number; mb: number; cmd: string };

async function processes(): Promise<Proc[]> {
  if (process.platform === 'win32') {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,CommandLine | ConvertTo-Json -Compress'], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    // PowerShell 5.1's ConvertTo-Json leaves a raw control character in a command line unescaped (invalid JSON);
    // the command line is only matched for the owner switch, so a space in its place is harmless.
    const rows = JSON.parse(stdout.replace(/[\u0000-\u001f]/g, ' ')) as Array<{ ProcessId: number; ParentProcessId: number; WorkingSetSize: number; CommandLine: string | null }>;
    return rows.map((r) => ({ pid: r.ProcessId, ppid: r.ParentProcessId, mb: Number(r.WorkingSetSize) / 1_048_576, cmd: r.CommandLine ?? '' }));
  }
  const { stdout } = await run('ps', ['-eo', 'pid=,ppid=,rss=,args='], { maxBuffer: 64 * 1024 * 1024 });
  return stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [pid, ppid, rss, ...rest] = l.split(/\s+/);
    return { pid: Number(pid), ppid: Number(ppid), mb: Number(rss) / 1024, cmd: rest.join(' ') };
  });
}

/** Working set of every Chromium this process launched (`--robot-owner=<ownerPid>`) and all of their children, in MB. */
export async function chromiumMb(ownerPid: number): Promise<number> {
  const all = await processes();
  const owned = new Set(all.filter((p) => p.cmd.includes(`${BROWSER_OWNER_SWITCH}${ownerPid}`)).map((p) => p.pid));
  let grew = true;
  while (grew) { grew = false; for (const p of all) if (!owned.has(p.pid) && owned.has(p.ppid)) { owned.add(p.pid); grew = true; } }
  return Math.round(all.filter((p) => owned.has(p.pid)).reduce((s, p) => s + p.mb, 0));
}

export function startMemorySampler(ownerPid: number, everyMs = 5000) {
  let chromiumPeakMb = 0; let nodePeakMb = 0; let samples = 0; let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      chromiumPeakMb = Math.max(chromiumPeakMb, await chromiumMb(ownerPid).catch(() => 0));
      nodePeakMb = Math.max(nodePeakMb, Math.round(process.memoryUsage().rss / 1_048_576));
      samples++;
      await new Promise((r) => setTimeout(r, everyMs));
    }
  })();
  return { stop: async () => { stopped = true; await loop; return { chromiumPeakMb, nodePeakMb, samples }; } };
}

const pct = (xs: number[], q: number) => { if (xs.length === 0) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]!; };
export const stats = (xs: number[]) => ({ median: pct(xs, 0.5), p90: pct(xs, 0.9), mean: xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0 });

export type PageValues = { data: Record<string, unknown>; shown: Record<string, unknown> };
export type Collected = {
  wallMs: number; done: number; failed: number; cyclesMs: number[]; captureMs: number[];
  modes: Record<string, number>; values: Record<string, PageValues>;
  truth: { checked: number; mismatches: Array<{ page: string; field: string; got: unknown; want: unknown }> };
};

/** Reads back what the runs wrote. `t0`: when the worker started (every run job was already queued). */
export async function collectRun(seeded: SeededSite[], t0: number): Promise<Collected> {
  const out: Collected = { wallMs: 0, done: 0, failed: 0, cyclesMs: [], captureMs: [], modes: {}, values: {}, truth: { checked: 0, mismatches: [] } };
  let lastEnd = t0;
  for (const s of seeded) {
    const r = await db.query.runs.findFirst({ where: eq(runs.id, s.runId), columns: { jobId: true, completedAt: true } });
    const job = r?.jobId ? await db.query.jobs.findFirst({ where: eq(jobs.id, r.jobId), columns: { startedAt: true } }) : null;
    let prev = job?.startedAt?.getTime() ?? t0;
    const names = Object.fromEntries(Object.entries(s.keys).map(([name, key]) => [key, name]));
    const items = await db.select().from(runItems).where(eq(runItems.runId, s.runId)).orderBy(asc(runItems.completedAt));
    for (const it of items) {
      if (it.status === 'failed') out.failed++;
      if (it.status !== 'done' || !it.completedAt || !it.extractionId) continue;
      out.done++;
      const end = it.completedAt.getTime();
      out.cyclesMs.push(end - prev); prev = end; lastEnd = Math.max(lastEnd, end);
      const ex = await db.query.extractions.findFirst({ where: eq(extractions.id, it.extractionId) });
      const cap = ex?.captureId ? await db.query.captures.findFirst({ where: eq(captures.id, ex.captureId), columns: { metadata: true } }) : null;
      const meta = (cap?.metadata ?? {}) as { capture?: { totalMs?: number }; lean?: { mode: string; reason: string | null } };
      if (meta.capture?.totalMs !== undefined) out.captureMs.push(meta.capture.totalMs);
      const mode = meta.lean ? `${meta.lean.mode}${meta.lean.reason ? `:${meta.lean.reason}` : ''}` : 'none';
      out.modes[mode] = (out.modes[mode] ?? 0) + 1;
      const row = ((ex?.data as Array<Record<string, unknown>> | null) ?? [])[0] ?? {};
      const vr = (ex?.validationResult ?? {}) as { shown?: Record<string, unknown> };
      const id = Number(new URL(it.url).pathname.split('/').pop());
      const data: Record<string, unknown> = {}; const shown: Record<string, unknown> = {};
      for (const [key, name] of Object.entries(names)) { data[name] = row[key] ?? null; shown[name] = vr.shown?.[key] ?? null; }
      const page = `${s.site}/${id}`;
      out.values[page] = { data, shown };
      const want = renderedTruth(product(s.site, id));
      for (const [field, w] of Object.entries(want)) {
        out.truth.checked++;
        if (JSON.stringify(data[field]) !== JSON.stringify(w)) out.truth.mismatches.push({ page, field, got: data[field], want: w });
      }
    }
  }
  out.wallMs = lastEnd - t0;
  return out;
}

export async function waitForRuns(runIds: string[], deadlineMs: number): Promise<void> {
  const until = Date.now() + deadlineMs;
  const terminal = new Set(['completed', 'partial', 'failed', 'cancelled']);
  for (;;) {
    const rows = await db.select({ status: runs.status }).from(runs).where(inArray(runs.id, runIds));
    if (rows.length === runIds.length && rows.every((r) => terminal.has(r.status))) return;
    if (Date.now() > until) throw new Error(`bench: runs not finished after ${Math.round(deadlineMs / 60_000)} min: ${rows.map((r) => r.status).join(', ')}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
