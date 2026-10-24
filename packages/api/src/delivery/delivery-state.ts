// What the run page says about a run's webhook (spec 2026-10-24 §3.4 "What is shown"), from its latest attempt:
// delivered, retrying (a failed attempt with attempts left) or failed (the last attempt failed). Staff also read
// the stored status code and error; a customer never does.
import { desc, eq } from 'drizzle-orm';
import { webhookDeliveries, type Database } from '@robot/db';

/** The `run-delivery` job's attempts (jobs/types.ts pins its policy to this). */
export const RUN_DELIVERY_ATTEMPTS = 5;

export type DeliveryState = 'delivered' | 'retrying' | 'failed';
export type RunDelivery = { state: DeliveryState; at: Date; statusCode?: number | null; error?: string | null };

export function deliveryOf(
  latest: { ok: boolean; attempt: number; at: Date; statusCode: number | null; error: string | null } | undefined,
  staff: boolean,
): RunDelivery | null {
  if (!latest) return null;
  const state: DeliveryState = latest.ok ? 'delivered' : latest.attempt < RUN_DELIVERY_ATTEMPTS ? 'retrying' : 'failed';
  return staff ? { state, at: latest.at, statusCode: latest.statusCode, error: latest.error } : { state, at: latest.at };
}

export async function loadRunDelivery(dbh: Database, runId: string, staff: boolean): Promise<RunDelivery | null> {
  const [latest] = await dbh
    .select({ ok: webhookDeliveries.ok, attempt: webhookDeliveries.attempt, at: webhookDeliveries.at, statusCode: webhookDeliveries.statusCode, error: webhookDeliveries.error })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.runId, runId))
    .orderBy(desc(webhookDeliveries.at), desc(webhookDeliveries.attempt))
    .limit(1);
  return deliveryOf(latest, staff);
}
