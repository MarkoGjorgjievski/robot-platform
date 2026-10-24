// Every job type the worker runs, with its policy (types.ts) and the status row its payload names.
import { JOB_POLICIES, type JobPayloads } from './types.js';
import type { Registry } from './runner.js';
import { testJobDefinitions } from './test-jobs.js';
import { runProofPageCapture } from '../verify/proof-page-capture.js';
import { runVerifyJob } from './handlers/verify.js';
import { runDriftCheck, storedCaptures } from '../verify/run-drift-check.js';
import { runCoverageCheck } from '../verify/run-coverage-check.js';
import { checkWebsite } from '../verify/website-checks.js';
import { runScheduledRun } from '../recurring/scheduled-run.js';
import { deliverRun } from '../delivery/run-delivery.js';
import { runExecuteJob, afterRunJob } from './handlers/run.js';
import { reachabilityNow, listingCheckNow, transferMarksNow, detectVariantsNow, variantLinksNearNow } from './handlers/interactive.js';
import { planSource } from '../crawl/plan-source.js';
import { db } from '@robot/db';

export function jobRegistry(opts: { testJobs?: boolean } = {}): Registry {
  const registry: Registry = {
    'proof-page-capture': {
      policy: JOB_POLICIES['proof-page-capture'],
      subject: (p: JobPayloads['proof-page-capture']) => ({ table: 'captures', id: p.captureId }),
      run: (p: JobPayloads['proof-page-capture']) => runProofPageCapture(p.captureId),
    },
    // The procedures that answered from a browser while the request waited: it waits for these (spec §4.4).
    reachability: { policy: JOB_POLICIES.reachability, run: (p: JobPayloads['reachability']) => reachabilityNow(p.url) },
    'listing-check': { policy: JOB_POLICIES['listing-check'], run: (p: JobPayloads['listing-check']) => listingCheckNow(p.listingUrl) },
    'transfer-marks': { policy: JOB_POLICIES['transfer-marks'], run: (p: JobPayloads['transfer-marks']) => transferMarksNow(p) },
    'detect-variants': { policy: JOB_POLICIES['detect-variants'], run: (p: JobPayloads['detect-variants']) => detectVariantsNow(p.sourceId) },
    'variant-links-near': { policy: JOB_POLICIES['variant-links-near'], run: (p: JobPayloads['variant-links-near']) => variantLinksNearNow(p) },
    // Its run row is written with the job (crawl/plan-via-worker.ts); planning fills it in.
    plan: {
      policy: JOB_POLICIES.plan,
      subject: (p: JobPayloads['plan']) => ({ table: 'runs', id: p.runId }),
      run: (p: JobPayloads['plan']) => planSource(db, p.sourceId, { probe: p.probe, runId: p.runId }),
    },
    verify: {
      policy: JOB_POLICIES.verify,
      subject: (p: JobPayloads['verify']) => ({ table: 'source_verifications', id: p.verificationId }),
      run: (p: JobPayloads['verify']) => runVerifyJob(p),
    },
    'drift-check': {
      policy: JOB_POLICIES['drift-check'],
      subject: (p: JobPayloads['drift-check']) => ({ table: 'drift_checks', id: p.checkId }),
      // A `verify` check reads the Verify's stored captures (no page load); any other re-captures its proof pages.
      run: (p: JobPayloads['drift-check']) => runDriftCheck(p.checkId, p.storedRefs ? { capture: storedCaptures(p.storedRefs) } : {}),
    },
    'coverage-check': {
      policy: JOB_POLICIES['coverage-check'],
      subject: (p: JobPayloads['coverage-check']) => ({ table: 'coverage_checks', id: p.checkId }),
      run: (p: JobPayloads['coverage-check']) => runCoverageCheck(p.checkId),
    },
    // Its drift and coverage rows are its own: a retry closes the earlier attempt's and starts afresh (spec §4.5).
    'website-check': {
      policy: JOB_POLICIES['website-check'],
      subject: () => null,
      run: (p: JobPayloads['website-check'], ctx) => checkWebsite(p.sourceId, { onPhase: ctx.progress }),
    },
    // Its run row is written with the job by the sweep (recurring/sweep.ts); planning fills it in, then the run starts.
    'scheduled-run': {
      policy: JOB_POLICIES['scheduled-run'],
      subject: (p: JobPayloads['scheduled-run']) => ({ table: 'runs', id: p.runId }),
      run: (p: JobPayloads['scheduled-run']) => runScheduledRun(p),
    },
    // No status row of its own: a failed delivery never closes or changes its run (spec 2026-10-24 §4.5).
    'run-delivery': {
      policy: JOB_POLICIES['run-delivery'],
      subject: () => null,
      run: (p: JobPayloads['run-delivery'], ctx) => deliverRun(p, ctx),
    },
    // One executor per run; a retry resumes it (its earlier attempt's `running` items back to pending).
    run: {
      policy: JOB_POLICIES.run,
      subject: (p: JobPayloads['run']) => ({ table: 'runs', id: p.runId }),
      run: (p: JobPayloads['run'], ctx) => runExecuteJob(p, ctx),
      // Work put back while the job was ending (its key still taken, so that enqueue added none) gets a new job (M4).
      afterDone: (p: JobPayloads['run'], value) => afterRunJob(p, value),
    },
  };
  return opts.testJobs ? { ...registry, ...testJobDefinitions() } : registry;
}
