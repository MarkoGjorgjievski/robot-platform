// Every job type the worker runs, with its policy (types.ts) and the status row its payload names.
import { JOB_POLICIES, type JobPayloads } from './types.js';
import type { Registry } from './runner.js';
import { testJobDefinitions } from './test-jobs.js';
import { runProofPageCapture } from '../verify/proof-page-capture.js';
import { runVerifyJob } from './handlers/verify.js';

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
  };
  return opts.testJobs ? { ...registry, ...testJobDefinitions() } : registry;
}
