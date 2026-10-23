// packages/api/src/jobs/errors.ts
// An error crosses from the worker to the api-server as JSON on the job row and is thrown again as the
// class the procedure expects: a TRPCError keeps its code, a CaptureProblemError its customer sentence.
import { TRPCError } from '@trpc/server';
import { CaptureProblemError } from '@robot/scraper';
import type { CaptureVerdict } from '@robot/browser';

export type SerializedError =
  | { kind: 'trpc'; code: TRPCError['code']; message: string }
  | { kind: 'capture-problem'; message: string; verdict?: CaptureVerdict }
  | { kind: 'error'; message: string }
  /** The job did not run to an answer: stalled, expired, lost, or the caller stopped waiting. */
  | { kind: 'unavailable'; message: string };

/** The job ran no answer in time (stalled, expired, crashed past its attempts, or the wait's ceiling). */
export class JobUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super(`The job did not finish: ${reason}`);
    this.name = 'JobUnavailableError';
  }
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof TRPCError) return { kind: 'trpc', code: err.code, message: err.message };
  if (err instanceof CaptureProblemError) return { kind: 'capture-problem', message: err.message, ...(err.verdict ? { verdict: err.verdict } : {}) };
  if (err instanceof JobUnavailableError) return { kind: 'unavailable', message: err.reason };
  const message = err instanceof Error ? err.message : String(err);
  return { kind: 'error', message: message.slice(0, 1000) };
}

export function rebuildError(e: SerializedError): Error {
  switch (e.kind) {
    case 'trpc': return new TRPCError({ code: e.code, message: e.message });
    case 'capture-problem': return new CaptureProblemError(e.message, e.verdict);
    case 'unavailable': return new JobUnavailableError(e.message);
    default: return new Error(e.message);
  }
}
