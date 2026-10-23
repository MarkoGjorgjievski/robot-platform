// The `verify` job (spec 2026-10-23 §4.4): a row already finished or closed is not run again; the
// clock starts with the work (the app reads `startedAt` for its stall line), then today's body.
import { and, eq, isNull } from 'drizzle-orm';
import { db, sourceVerifications } from '@robot/db';
import { runSourceVerification } from '../../verify/run-source-verification.js';
import type { JobPayloads } from '../types.js';

export async function runVerifyJob(p: JobPayloads['verify']): Promise<void> {
  const [open] = await db.update(sourceVerifications).set({ startedAt: new Date() })
    .where(and(eq(sourceVerifications.id, p.verificationId), isNull(sourceVerifications.completedAt)))
    .returning({ id: sourceVerifications.id });
  if (!open) return;
  await runSourceVerification(p.sourceId, p.verificationId, {
    ...(p.onlyKeys ? { onlyKeys: p.onlyKeys } : {}), ...(p.free ? { free: true } : {}),
    ...(p.origin ? { origin: p.origin } : {}), ...(p.captureRefs ? { captureRefs: p.captureRefs } : {}),
  });
}
