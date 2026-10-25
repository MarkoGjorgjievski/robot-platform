// Spec 2026-10-25 monitoring §2.4, §3.4, §4 "Unit": the POST's shape, the token, the timeout, the rate limit, never throwing.
import { afterEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createErrorReporter, REPORTS_PER_MINUTE } from './errors.js';
import { createLog, type LogLevel } from './log.js';
import { startErrorReceiver } from '../test-helpers/error-receiver.js';

type Receiver = Awaited<ReturnType<typeof startErrorReceiver>>;
let receivers: Receiver[] = [];
afterEach(async () => { await Promise.all(receivers.map((r) => r.close())); receivers = []; });
const receiver = async (o: { status?: number; delayMs?: number } = {}) => { const r = await startErrorReceiver(o); receivers.push(r); return r; };
const quiet = () => {
  const lines: Array<{ line: string; level: LogLevel }> = [];
  return { lines, log: createLog('errors', { env: { LOG_FORMAT: 'json' }, sink: (line, level) => lines.push({ line, level }) }) };
};

describe('reportError (spec 2026-10-25 monitoring §2.4)', () => {
  it('POSTs one redacted report with the service, version, host and the Bearer token, and logs it at error', async () => {
    const r = await receiver();
    const { lines, log } = quiet();
    const rep = createErrorReporter({ service: () => 'worker', env: () => ({ ERROR_REPORT_URL: r.url, ERROR_REPORT_TOKEN: 'report-token-1' }), log });
    await rep.report(new Error('lost http://u:rep-pass@gate.test:7000'), { jobId: 'j1', token: 'ctx-token', url: 'smtp://m:mail-pass@smtp.test:25' });
    expect(r.reports).toHaveLength(1);
    const { body, headers, raw } = r.reports[0]!;
    expect(headers['content-type']).toContain('application/json');
    expect(headers.authorization).toBe('Bearer report-token-1');
    expect(Object.keys(body).sort()).toEqual(['context', 'host', 'level', 'message', 'service', 'stack', 't', 'version']);
    expect(body).toMatchObject({
      service: 'worker', level: 'error', message: 'lost http://***@gate.test:7000', host: os.hostname(),
      context: { jobId: 'j1', token: '***', url: 'smtp://***@smtp.test:25' },
    });
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
    expect(new Date(body.t).toISOString()).toBe(body.t);
    expect(body.stack).toContain('http://***@gate.test:7000');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.level).toBe('error');
    for (const s of ['rep-pass', 'ctx-token', 'mail-pass', 'report-token-1']) {
      expect(raw).not.toContain(s);
      expect(lines[0]!.line).not.toContain(s);
    }
  });

  it('RF2: a report’s cause chain and text fields are redacted too', async () => {
    const r = await receiver();
    const rep = createErrorReporter({ service: () => 'api-server', env: () => ({ ERROR_REPORT_URL: r.url }), log: quiet().log });
    const cause = new Error('auth failed for postgresql://robot:cause-pass@db.test:5432/robot');
    await rep.report(new Error('outer', { cause }), { link: '/export/run/r1?sig=cafebabe1234', header: 'Bearer zzz.yyy' });
    expect(r.reports[0]!.raw).not.toMatch(/cause-pass|cafebabe1234|zzz\.yyy/);
  });

  it('no token: no Authorization header; no URL: logged, nothing sent', async () => {
    const r = await receiver();
    await createErrorReporter({ service: () => 'worker', env: () => ({ ERROR_REPORT_URL: r.url }), log: quiet().log }).report(new Error('x'));
    expect(r.reports[0]!.headers.authorization).toBeUndefined();
    const { lines, log } = quiet();
    let called = 0;
    await createErrorReporter({ service: () => 'worker', env: () => ({}), fetch: (async () => { called++; return new Response(null); }) as typeof fetch, log }).report(new Error('only logged'));
    expect(called).toBe(0);
    expect(JSON.parse(lines[0]!.line)).toMatchObject({ level: 'error', scope: 'errors', msg: 'only logged' });
  });

  it('a receiver that hangs, answers 500, or is not there: report resolves within the timeout, warns, never throws', async () => {
    const slow = await receiver({ delayMs: 10_000 });
    const a = quiet();
    const t0 = Date.now();
    await createErrorReporter({ service: () => 'worker', env: () => ({ ERROR_REPORT_URL: slow.url }), log: a.log, timeoutMs: 200 }).report(new Error('slow'));
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(a.lines.some((l) => l.level === 'warn')).toBe(true);
    const failing = await receiver({ status: 500 });
    const b = quiet();
    await createErrorReporter({ service: () => 'worker', env: () => ({ ERROR_REPORT_URL: failing.url }), log: b.log }).report(new Error('500'));
    expect(b.lines.some((l) => l.level === 'warn' && l.line.includes('500'))).toBe(true);
    const gone = await startErrorReceiver();
    await gone.close();
    await expect(createErrorReporter({ service: () => 'worker', env: () => ({ ERROR_REPORT_URL: gone.url }), log: quiet().log }).report(new Error('gone'))).resolves.toBeUndefined();
  });

  it('at most 30 a minute; the rest are dropped and counted in the next one', async () => {
    const r = await receiver();
    let now = 1_000_000;
    const rep = createErrorReporter({ service: () => 'api-server', env: () => ({ ERROR_REPORT_URL: r.url }), now: () => now, log: quiet().log });
    await Promise.all(Array.from({ length: 35 }, (_, i) => rep.report(new Error(`e${i}`))));
    expect(r.reports).toHaveLength(REPORTS_PER_MINUTE);
    expect(r.reports.every((x) => x.body.dropped === undefined)).toBe(true);
    now += 60_001;
    await rep.report(new Error('after'));
    expect(r.reports).toHaveLength(31);
    expect(r.reports[30]!.body).toMatchObject({ message: 'after', dropped: 5 });
  });

  it('never throws, whatever it is given', async () => {
    const rep = createErrorReporter({
      service: () => 'worker', env: () => ({ ERROR_REPORT_URL: 'http://127.0.0.1:9/x' }),
      fetch: (() => { throw new Error('sync'); }) as unknown as typeof fetch, log: quiet().log,
    });
    const odd = { toString() { throw new Error('no'); } };
    for (const v of [undefined, null, 'plain string', 42, odd, Object.create(null)]) await expect(rep.report(v)).resolves.toBeUndefined();
  });
});

describe('process handlers (spec 2026-10-25 monitoring §2.4)', () => {
  const fixture = fileURLToPath(new URL('./fixtures/crash.ts', import.meta.url));
  const pkg = fileURLToPath(new URL('../..', import.meta.url));
  const run = (mode: string, url: string) => new Promise<number | null>((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', fixture, mode], { cwd: pkg, stdio: 'ignore', env: { ...process.env, ERROR_REPORT_URL: url, LOG_LEVEL: 'error' } });
    child.once('exit', (code) => resolve(code));
  });

  it('an uncaught exception is reported, redacted, and then the process exits 1', async () => {
    const r = await receiver();
    expect(await run('throw', r.url)).toBe(1);
    expect(r.reports).toHaveLength(1);
    expect(r.reports[0]!.body).toMatchObject({ service: 'worker', context: { origin: 'uncaughtException' } });
    expect(r.reports[0]!.raw).not.toContain('fixture-secret');
  }, 30_000);

  it('an unhandled rejection is reported and the process goes on', async () => {
    const r = await receiver();
    expect(await run('reject', r.url)).toBe(0);
    expect(r.reports).toHaveLength(1);
    expect(r.reports[0]!.body).toMatchObject({ service: 'worker', context: { origin: 'unhandledRejection' } });
    expect(r.reports[0]!.raw).not.toContain('fixture-secret');
  }, 30_000);
});
