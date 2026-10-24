// packages/api/src/delivery/run-delivery.ts
// The run-delivery job (spec 2026-10-24 §3.3–§3.4): when a run of a website with a schedule or a webhook settles,
// its file is written (three formats, run_files) and, with a webhook, one signed `run.finished` POST carries
// signed links to it. A failed attempt is recorded and thrown, so the job retries it (30 s, doubling; five
// attempts) with the same delivery id. Nothing here ever changes a run's status or rows (§4.5).
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, datasets, projects, runItems, runs, sources, webhookDeliveries, type Database } from '@robot/db';
import { enqueue } from '../jobs/enqueue.js';
import type { JobContext } from '../jobs/context.js';
import type { JobPayloads } from '../jobs/types.js';
import { EXPORT_FORMATS, type ExportFormat } from '../export/render-run-export.js';
import { SCHEDULED_LABEL } from '../recurring/schedule.js';
import { writeRunFiles } from './run-files.js';
import { bodySignature, LINK_TTL_S, publicApiUrl, signedFileUrl } from './signing.js';
import { postWebhook } from './webhook-post.js';
import { webhookPrivateAllowed } from './webhook-url.js';
import { runDeliveryKey } from './delivery-state.js';

export class WebhookNotDelivered extends Error {}

/** Spec §3.3: completed and partial always; failed and cancelled only with at least one row. */
export function deliverable(status: string, rows: number | null): boolean {
  if (status === 'completed' || status === 'partial') return true;
  if (status === 'failed' || status === 'cancelled') return (rows ?? 0) > 0;
  return false;
}

/**
 * Called by `buildFinalise` once a run settled. A sample never delivers (its rows are a preview); a backfill merges
 * into its parent, so the parent's file is written again and posted again — the job is the parent's. One job per
 * run while one is queued or running (key `run-delivery:<runId>`). Null when nothing is delivered.
 */
export async function enqueueRunDelivery(dbh: Database, runId: string): Promise<string | null> {
  const run = await dbh.query.runs.findFirst({ where: eq(runs.id, runId), columns: { id: true, parentRunId: true, inputLabel: true } });
  if (!run || run.inputLabel === 'probe') return null;
  const target = await dbh.query.runs.findFirst({
    where: eq(runs.id, run.parentRunId ?? run.id),
    columns: { id: true, status: true, resultCount: true, inputLabel: true, sourceId: true },
  });
  if (!target?.sourceId || target.inputLabel === 'probe' || !deliverable(target.status, target.resultCount)) return null;
  const source = await dbh.query.sources.findFirst({ where: eq(sources.id, target.sourceId), columns: { schedule: true, webhookUrl: true } });
  if (!source || (source.schedule == null && !source.webhookUrl)) return null;
  return enqueue(dbh, 'run-delivery', { runId: target.id, deliveryId: randomUUID() }, { key: runDeliveryKey(target.id) });
}

export type WebhookBody = {
  event: 'run.finished';
  deliveryId: string;
  runId: string;
  status: string;
  scheduled: boolean;
  website: { id: string; name: string };
  project: { id: string; name: string };
  startedAt: string | null;
  completedAt: string | null;
  rows: number;
  failedItems: number;
  files: Record<ExportFormat, string>;
  filesExpireAt: string;
};

/** Spec §3.4's body, its links signed to expire `LINK_TTL_S` after `nowMs`. */
export function webhookBody(a: {
  deliveryId: string;
  run: { id: string; status: string; inputLabel: string | null; startedAt: Date | null; completedAt: Date | null };
  website: { id: string; name: string };
  project: { id: string; name: string };
  rows: number;
  failedItems: number;
  base: string;
  secret: string;
  nowMs: number;
}): WebhookBody {
  const expires = Math.floor(a.nowMs / 1000) + LINK_TTL_S;
  return {
    event: 'run.finished',
    deliveryId: a.deliveryId,
    runId: a.run.id,
    status: a.run.status,
    scheduled: a.run.inputLabel === SCHEDULED_LABEL,
    website: a.website,
    project: a.project,
    startedAt: a.run.startedAt?.toISOString() ?? null,
    completedAt: a.run.completedAt?.toISOString() ?? null,
    rows: a.rows,
    failedItems: a.failedItems,
    files: Object.fromEntries(EXPORT_FORMATS.map((f) => [f, signedFileUrl(a.base, a.secret, a.run.id, f, expires)])) as Record<ExportFormat, string>,
    filesExpireAt: new Date(expires * 1000).toISOString(),
  };
}

export function webhookHeaders(secret: string, body: string, deliveryId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'robot-platform-webhook/1',
    'X-Robot-Event': 'run.finished',
    'X-Robot-Delivery': deliveryId,
    'X-Robot-Signature': bodySignature(secret, body),
  };
}

export async function deliverRun(
  p: JobPayloads['run-delivery'],
  ctx: Pick<JobContext, 'attempt'>,
  deps: { post?: typeof postWebhook; env?: Record<string, string | undefined>; now?: () => number } = {},
): Promise<{ files: boolean; delivered: boolean | null }> {
  // Checked again now, not only at enqueue: a run resumed or re-opened since is not one to send (its status would
  // be outside §3.4's list), and nothing is written or posted for it.
  const now = await db.query.runs.findFirst({ where: eq(runs.id, p.runId), columns: { status: true, resultCount: true } });
  if (!now || !deliverable(now.status, now.resultCount)) return { files: false, delivered: null };
  const written = await writeRunFiles(db, p.runId);
  if (!written) return { files: false, delivered: null };
  const [hit] = await db
    .select({
      run: { id: runs.id, status: runs.status, inputLabel: runs.inputLabel, startedAt: runs.startedAt, completedAt: runs.completedAt },
      website: { id: sources.id, name: sources.name, webhookUrl: sources.webhookUrl, webhookSecret: sources.webhookSecret },
      project: { id: projects.id, name: projects.name },
    })
    .from(runs)
    .innerJoin(sources, eq(runs.sourceId, sources.id))
    .innerJoin(datasets, eq(sources.datasetId, datasets.id))
    .innerJoin(projects, eq(datasets.projectId, projects.id))
    .where(eq(runs.id, p.runId))
    .limit(1);
  if (!hit?.website.webhookUrl || !hit.website.webhookSecret) return { files: true, delivered: null };
  const [failed] = await db.select({ n: sql<number>`count(*)::int` }).from(runItems)
    .where(and(eq(runItems.runId, p.runId), eq(runItems.kind, 'detail'), eq(runItems.status, 'failed')));
  const env = deps.env ?? process.env;
  const secret = hit.website.webhookSecret;
  const body = JSON.stringify(webhookBody({
    deliveryId: p.deliveryId, run: hit.run, website: { id: hit.website.id, name: hit.website.name }, project: hit.project,
    rows: written.rows, failedItems: Number(failed?.n ?? 0), base: publicApiUrl(env), secret, nowMs: (deps.now ?? Date.now)(),
  }));
  const result = await (deps.post ?? postWebhook)(hit.website.webhookUrl, body, webhookHeaders(secret, body, p.deliveryId), { allowPrivate: webhookPrivateAllowed(env) });
  await db.insert(webhookDeliveries).values({ runId: p.runId, deliveryId: p.deliveryId, attempt: ctx.attempt, ok: result.ok, statusCode: result.statusCode, error: result.error });
  if (!result.ok) throw new WebhookNotDelivered(`webhook not delivered: ${result.error ?? `answered ${result.statusCode}`}`);
  return { files: true, delivered: true };
}
