// What the run page says about a run's webhook (spec 2026-10-24 §3.4 "What is shown"), from its latest attempt:
// delivered, retrying (a failed attempt while the run's delivery job is still queued or running, attempts left) or
// failed (the last attempt failed, or the job stopped for good — failed, reaped, purged — before its fifth attempt,
// so no attempt is coming). Staff also read the stored status code and error; a customer never does.
import { and, desc, eq, inArray } from 'drizzle-orm';
import { jobs, webhookDeliveries, type Database } from '@robot/db';
import { jobQueueName } from '../jobs/queue.js';

/** The `run-delivery` job's attempts (jobs/types.ts pins its policy to this). */
export const RUN_DELIVERY_ATTEMPTS = 5;

export type DeliveryState = 'delivered' | 'retrying' | 'failed';
export type RunDelivery = { state: DeliveryState; at: Date; statusCode?: number | null; error?: string | null };

/** `pending`: the run's delivery job is still queued or running, so a failed attempt may yet be retried. */
export function deliveryOf(
  latest: { ok: boolean; attempt: number; at: Date; statusCode: number | null; error: string | null } | undefined,
  staff: boolean,
  pending = true,
): RunDelivery | null {
  if (!latest) return null;
  const state: DeliveryState = latest.ok ? 'delivered' : pending && latest.attempt < RUN_DELIVERY_ATTEMPTS ? 'retrying' : 'failed';
  return staff ? { state, at: latest.at, statusCode: latest.statusCode, error: latest.error } : { state, at: latest.at };
}

/** The job's key (delivery/run-delivery.ts enqueues with it): one queued or running delivery per run. */
export const runDeliveryKey = (runId: string) => `run-delivery:${runId}`;

export async function loadRunDelivery(dbh: Database, runId: string, staff: boolean): Promise<RunDelivery | null> {
  const [latest] = await dbh
    .select({ ok: webhookDeliveries.ok, attempt: webhookDeliveries.attempt, at: webhookDeliveries.at, statusCode: webhookDeliveries.statusCode, error: webhookDeliveries.error })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.runId, runId))
    .orderBy(desc(webhookDeliveries.at), desc(webhookDeliveries.attempt))
    .limit(1);
  if (!latest || latest.ok || latest.attempt >= RUN_DELIVERY_ATTEMPTS) return deliveryOf(latest, staff);
  const [live] = await dbh
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.queue, jobQueueName()), eq(jobs.key, runDeliveryKey(runId)), inArray(jobs.status, ['queued', 'running'])))
    .limit(1);
  return deliveryOf(latest, staff, !!live);
}
