// Every job type the worker runs, with its policy (types.ts) and the status row its payload names.
import { JOB_POLICIES, type JobPayloads } from './types.js';
import type { Registry } from './runner.js';
import { testJobDefinitions } from './test-jobs.js';
import { runProofPageCapture } from '../verify/proof-page-capture.js';
import { runVerifyJob } from './handlers/verify.js';
import { runDriftCheck, storedCaptures } from '../verify/run-drift-check.js';
import { runCoverageCheck } from '../verify/run-coverage-check.js';
import { checkWebsite } from '../verify/website-checks.js';

export function jobRegistry(opts: { testJobs?: boolean } = {}): Registry {
  const registry: Registry = {
    'proof-page-capture': {
      policy: JOB_POLICIES['proof-page-capture'],
      subject: (p: JobPayloads['proof-page-capture']) => ({ table: 'captures', id: p.captureId }),
      run: (p: JobPayloads['proof-page-capture']) => runProofPageCapture(p.captureId),
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
  };
  return opts.testJobs ? { ...registry, ...testJobDefinitions() } : registry;
}
