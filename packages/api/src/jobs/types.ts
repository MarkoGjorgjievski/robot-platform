// packages/api/src/jobs/types.ts
// What each kind of job is, where it runs and how it fails (spec 2026-10-23 capture worker §4.2).
// Plain data: enqueuers read it without importing a handler (handlers import the enqueuers).
import type { StoredCaptureRef } from '../verify/capture-store.js';

export type Lane = 'interactive' | 'background' | 'runs';

export type JobPolicy = {
  lane: Lane;
  /** Lower is claimed first. */
  priority: number;
  maxAttempts: number;
  /** Stopped when no `ctx.progress()` (or start) for this long. */
  stuckMs: number;
  /** Failed 'expired' when not started this long after it was enqueued; null: no limit. */
  startWithinMs: number | null;
  /** At most this many of this type at once in one worker. */
  maxConcurrent?: number;
  /** A stuck job is retried (while attempts remain) instead of failed: only for work that resumes. */
  retryOnStuck?: boolean;
  /** What a run row stamped with this job says when the job fails for good. */
  runSentence?: string;
};

/** Spec §6, customer copy. */
export const RUN_STOPPED = 'This run stopped before it finished. Extract again to pick up where it left off.';
export const PLAN_STOPPED = 'Finding the products stopped before it finished. Try again.';

const MIN = 60_000;

export const JOB_POLICIES = {
  'proof-page-capture': { lane: 'interactive', priority: 10, maxAttempts: 2, stuckMs: 3 * MIN, startWithinMs: 5 * MIN },
  reachability: { lane: 'interactive', priority: 0, maxAttempts: 1, stuckMs: MIN, startWithinMs: MIN },
  'listing-check': { lane: 'interactive', priority: 0, maxAttempts: 1, stuckMs: 90_000, startWithinMs: MIN },
  'transfer-marks': { lane: 'interactive', priority: 0, maxAttempts: 1, stuckMs: MIN, startWithinMs: MIN },
  'detect-variants': { lane: 'interactive', priority: 0, maxAttempts: 1, stuckMs: MIN, startWithinMs: MIN },
  'variant-links-near': { lane: 'interactive', priority: 0, maxAttempts: 1, stuckMs: 30_000, startWithinMs: MIN },
  plan: { lane: 'interactive', priority: 5, maxAttempts: 1, stuckMs: 15 * MIN, startWithinMs: 2 * MIN, runSentence: PLAN_STOPPED },
  verify: { lane: 'background', priority: 10, maxAttempts: 2, stuckMs: 14 * MIN, startWithinMs: 15 * MIN },
  'drift-check': { lane: 'background', priority: 20, maxAttempts: 2, stuckMs: 9 * MIN, startWithinMs: 30 * MIN },
  'coverage-check': { lane: 'background', priority: 20, maxAttempts: 2, stuckMs: 9 * MIN, startWithinMs: 30 * MIN },
  'website-check': { lane: 'background', priority: 30, maxAttempts: 2, stuckMs: 25 * MIN, startWithinMs: null, maxConcurrent: 1 },
  run: { lane: 'runs', priority: 10, maxAttempts: 3, stuckMs: 15 * MIN, startWithinMs: null, retryOnStuck: true, runSentence: RUN_STOPPED },
} as const satisfies Record<string, JobPolicy>;

export type JobType = keyof typeof JOB_POLICIES;

export type VerifyJobOptions = {
  onlyKeys?: string[];
  free?: boolean;
  origin?: 'customer' | 'refresh';
  captureRefs?: Record<string, StoredCaptureRef>;
};

export type TransferMarksPayload = {
  sourceId: string;
  fromUrl: string;
  toUrls: string[];
  from?: Record<string, { value: string; mark?: unknown; via?: unknown }>;
  fieldKeys?: string[];
};

export type JobPayloads = {
  'proof-page-capture': { captureId: string };
  reachability: { url: string };
  'listing-check': { listingUrl: string };
  'transfer-marks': TransferMarksPayload;
  'detect-variants': { sourceId: string };
  'variant-links-near': { sourceId: string; url: string; xpath: string };
  plan: { sourceId: string; runId: string; probe: boolean };
  verify: { sourceId: string; verificationId: string } & VerifyJobOptions;
  'drift-check': { checkId: string; storedRefs?: Record<string, StoredCaptureRef> };
  'coverage-check': { checkId: string };
  'website-check': { sourceId: string };
  run: { runId: string; limit?: number; repairSweep?: { deadFields: string[] } };
};
