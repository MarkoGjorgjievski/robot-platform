// packages/api/src/jobs/types.ts
// What each kind of job is, where it runs and how it fails (spec 2026-10-23 capture worker §4.2).
// Plain data: enqueuers read it without importing a handler (handlers import the enqueuers).
import type { StoredCaptureRef } from '../verify/capture-store.js';
import type { ConfirmedPath, Mark } from '@robot/scraper';

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
  // Spec 2026-10-24 §3.2: plans a scheduled run (its run row is written with the job by the sweep), then starts it.
  'scheduled-run': { lane: 'background', priority: 20, maxAttempts: 1, stuckMs: 15 * MIN, startWithinMs: null, runSentence: PLAN_STOPPED },
  // Spec 2026-10-24 §3.3: writes a settled run's file and posts its webhook; a failed post is retried (30 s, doubling).
  // Five attempts — delivery/delivery-state.ts's RUN_DELIVERY_ATTEMPTS, pinned by run-delivery.test.ts.
  'run-delivery': { lane: 'background', priority: 15, maxAttempts: 5, stuckMs: 5 * MIN, startWithinMs: null },
  // Spec 2026-10-24 email §3.3: sends one email_messages row; a failed send is retried (30 s, doubling), five attempts —
  // email/send-email.ts's EMAIL_ATTEMPTS, pinned by send-email.test.ts.
  email: { lane: 'background', priority: 25, maxAttempts: 5, stuckMs: 2 * MIN, startWithinMs: null },
  run: { lane: 'runs', priority: 10, maxAttempts: 3, stuckMs: 15 * MIN, startWithinMs: null, retryOnStuck: true, runSentence: RUN_STOPPED },
} as const satisfies Record<string, JobPolicy>;

export type JobType = keyof typeof JOB_POLICIES;

/** What a run row stamped with a job of this type says when the job fails for good — the one place the runner, the reaper and awaitJob read it. */
export function runSentenceFor(type: string): string {
  return (JOB_POLICIES as Record<string, JobPolicy>)[type]?.runSentence ?? RUN_STOPPED;
}

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
  from?: Record<string, { value: string; mark?: Mark; via?: ConfirmedPath }>;
  fieldKeys?: string[];
};

export type JobPayloads = {
  'proof-page-capture': { captureId: string };
  /** `sourceId`: the website the address belongs to — its pages load through its profile (spec 2026-10-24 proxy §2.2). */
  reachability: { url: string; sourceId?: string };
  'listing-check': { listingUrl: string; sourceId?: string };
  'transfer-marks': TransferMarksPayload;
  'detect-variants': { sourceId: string };
  'variant-links-near': { sourceId: string; url: string; xpath: string };
  plan: { sourceId: string; runId: string; probe: boolean };
  verify: { sourceId: string; verificationId: string } & VerifyJobOptions;
  'drift-check': { checkId: string; storedRefs?: Record<string, StoredCaptureRef> };
  'coverage-check': { checkId: string };
  'website-check': { sourceId: string };
  'scheduled-run': { sourceId: string; runId: string };
  'run-delivery': { runId: string; deliveryId: string };
  email: { messageId: string };
  run: { runId: string; limit?: number; repairSweep?: { deadFields: string[] } };
};
