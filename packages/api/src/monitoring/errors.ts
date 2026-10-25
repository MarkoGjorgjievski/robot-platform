// The error hook (spec 2026-10-25 monitoring §2.4): `reportError(err, context)` logs at error and, with
// ERROR_REPORT_URL set, POSTs one redacted JSON report — 5 s timeout, fire-and-forget, never throwing, at most 30 a
// minute per process (the rest dropped and counted in the next one), ERROR_REPORT_TOKEN as a Bearer header. A generic
// hook: a Sentry or Logtail ingestion endpoint, or our own receiver. Env is read at each report.
import os from 'node:os';
import { createLog, type Log } from './log.js';
import { redactText, redactValue } from './redact.js';
import { serviceVersion } from './version.js';

type Env = Record<string, string | undefined>;
export type ErrorReport = {
  t: string; service: string; level: 'error'; message: string; stack: string | null;
  context: Record<string, unknown>; version: string; host: string; dropped?: number;
};
export type ErrorReporter = { report(err: unknown, context?: Record<string, unknown>): Promise<void>; flush(ms: number): Promise<void> };

export const REPORTS_PER_MINUTE = 30;
export const REPORT_TIMEOUT_MS = 5000;
export const FLUSH_ON_EXIT_MS = 2000;
const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;

function asError(err: unknown): Error {
  if (err instanceof Error) return err;
  let text: string;
  try { text = typeof err === 'string' ? err : JSON.stringify(err) ?? String(err); } catch {
    try { text = String(err); } catch { text = '[unprintable]'; }
  }
  return new Error(text);
}

export function createErrorReporter(opts: {
  service: () => string; env?: () => Env; fetch?: typeof fetch; now?: () => number; log?: Log; perMinute?: number; timeoutMs?: number;
}): ErrorReporter {
  const log = opts.log ?? createLog('errors');
  const now = opts.now ?? Date.now;
  const sent: number[] = [];
  let dropped = 0;
  const inFlight = new Set<Promise<void>>();
  return {
    report(err, context = {}) {
      try {
        const e = asError(err);
        const message = redactText(e.message).slice(0, MAX_MESSAGE);
        const ctx = (redactValue(context) ?? {}) as Record<string, unknown>;
        log.error(message, { ...ctx, error: e });
        const env = (opts.env ?? (() => process.env))();
        const url = (env.ERROR_REPORT_URL ?? '').trim();
        if (!url) return Promise.resolve();
        const at = now();
        while (sent.length > 0 && at - sent[0]! >= 60_000) sent.shift();
        if (sent.length >= (opts.perMinute ?? REPORTS_PER_MINUTE)) { dropped++; return Promise.resolve(); }
        sent.push(at);
        const body: ErrorReport = {
          t: new Date(at).toISOString(), service: opts.service(), level: 'error', message,
          stack: e.stack ? redactText(e.stack).slice(0, MAX_STACK) : null, context: ctx, version: serviceVersion(), host: os.hostname(),
          ...(dropped > 0 ? { dropped } : {}),
        };
        dropped = 0;
        const token = (env.ERROR_REPORT_TOKEN ?? '').trim();
        const p = (opts.fetch ?? fetch)(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? REPORT_TIMEOUT_MS),
        }).then(
          (res) => { void res.body?.cancel().catch(() => {}); if (!res.ok) log.warn(`error report answered ${res.status}`); },
          (postErr: unknown) => log.warn('error report could not be sent', { reason: postErr instanceof Error ? postErr.message : String(postErr) }),
        ).catch(() => {});
        inFlight.add(p);
        void p.finally(() => inFlight.delete(p));
        return p;
      } catch {
        return Promise.resolve();
      }
    },
    async flush(ms) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([Promise.allSettled([...inFlight]), new Promise((r) => { timer = setTimeout(r, ms); })]);
      clearTimeout(timer);
    },
  };
}

let service = 'unknown';
const reporter = createErrorReporter({ service: () => service });

/** Which service this process's reports name. The worker calls it in `startWorker`; both servers via `installProcessHandlers`. */
export function configureErrorReports(opts: { service: 'api-server' | 'worker' }): void {
  service = opts.service;
}

export function reportError(err: unknown, context?: Record<string, unknown>): Promise<void> {
  return reporter.report(err, context);
}

export function flushErrorReports(ms: number = FLUSH_ON_EXIT_MS): Promise<void> {
  return reporter.flush(ms);
}

let installed = false;

/** An unhandled rejection is reported and the process goes on; an uncaught exception is reported, flushed (≤ 2 s), and the process exits 1. */
export function installProcessHandlers(name: 'api-server' | 'worker'): void {
  configureErrorReports({ service: name });
  // Read once now: serviceVersion() may run git synchronously, never inside an error handler (Task 3 review).
  serviceVersion();
  if (installed) return;
  installed = true;
  process.on('unhandledRejection', (reason) => { void reportError(reason, { origin: 'unhandledRejection' }); });
  process.on('uncaughtException', (err) => {
    void reportError(err, { origin: 'uncaughtException' });
    void flushErrorReports(FLUSH_ON_EXIT_MS).finally(() => process.exit(1));
  });
}
