// packages/api/src/email/run-failed.ts
// Spec 2026-10-24 email §3.1: a run that settled `failed` (never a sample) emails the org's owners and admins who keep
// failed-run emails on — called on every terminal path, next to enqueueRunDelivery. The dedupe key (run, person) makes
// a run reported by two paths one email per person; any other status sends nothing. Never throws (§4.3).
import type { Database } from '@robot/db';
import { queueEmailsSafely } from './queue-emails.js';

export async function notifyRunFailed(dbh: Database, runId: string): Promise<number> {
  return queueEmailsSafely(dbh, { kind: 'run-failed', runId });
}
