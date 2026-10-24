// packages/api/src/email/queue-emails.ts
// Spec 2026-10-24 email §3.2–§3.3: an event becomes one email_messages row per recipient — rendered now, with its
// unique dedupe key — and one `email` job per row, in one transaction (a savepoint inside a caller's). A key already
// taken inserts nothing and enqueues nothing. The api-server never reads SMTP_URL (spec §6): whether mail is on is
// the worker's to know, and its job marks the row skipped.
import { eq } from 'drizzle-orm';
import { datasets, emailMessages, orgs, projects, runs, sources, type MembershipRole } from '@robot/db';
import type { SchemaDefinitionField } from '@robot/scraper';
import { attentionSentence } from '@robot/scraper/customer-copy';
import type { DbOrTx } from '../jobs/queue.js';
import { enqueue } from '../jobs/enqueue.js';
import type { Attention } from '../verify/attention.js';
import { publicAppUrl, type Env } from './config.js';
import { attentionEmail, removedEmail, roleChangedEmail, runFailedEmail, staffAccessEmail, type RenderedEmail } from './render.js';
import { orgLookouts, orgMember, type Recipient } from './recipients.js';

export type EmailEvent =
  | { kind: 'attention'; sourceId: string; since: Date; attention: Pick<Attention, 'fields' | 'goneProducts' | 'heldSince'>; runnable: boolean }
  | { kind: 'run-failed'; runId: string }
  | { kind: 'staff-access'; staffActionId: string; orgId: string; actorUserId: string; sourceId: string | null }
  | { kind: 'role-changed'; membershipId: string; orgId: string; userId: string; role: MembershipRole; at: Date }
  | { kind: 'removed'; orgId: string; userId: string; at: Date };

/** Spec §3.2, verbatim. */
export function dedupeKey(event: EmailEvent, userId: string): string {
  switch (event.kind) {
    case 'attention': return `attention:${event.sourceId}:${event.since.getTime()}:${userId}`;
    case 'run-failed': return `run-failed:${event.runId}:${userId}`;
    case 'staff-access': return `staff-access:${event.staffActionId}:${userId}`;
    case 'role-changed': return `role-changed:${event.membershipId}:${event.role}:${event.at.getTime()}:${userId}`;
    case 'removed': return `removed:${event.orgId}:${userId}:${event.at.getTime()}`;
  }
}

export function emailJobKey(messageId: string): string {
  return `email:${messageId}`;
}

type Built = { orgId: string; recipients: Recipient[]; rendered: RenderedEmail };

/** A customer website's names and slugs; null for a website with no project (a sandbox). */
async function websitePlace(dbh: DbOrTx, sourceId: string) {
  const [w] = await dbh
    .select({
      orgId: orgs.id, org: orgs.name, project: projects.name, projectSlug: projects.slug,
      website: sources.name, siteSlug: sources.slug, schemaDefinition: sources.schemaDefinition,
    })
    .from(sources)
    .innerJoin(datasets, eq(sources.datasetId, datasets.id))
    .innerJoin(projects, eq(datasets.projectId, projects.id))
    .innerJoin(orgs, eq(projects.orgId, orgs.id))
    .where(eq(sources.id, sourceId))
    .limit(1);
  return w ?? null;
}

async function orgName(dbh: DbOrTx, orgId: string): Promise<string | null> {
  const [o] = await dbh.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
  return o?.name ?? null;
}

async function build(dbh: DbOrTx, event: EmailEvent, base: string): Promise<Built | null> {
  switch (event.kind) {
    case 'attention': {
      const w = await websitePlace(dbh, event.sourceId);
      if (!w) return null;
      const fields = (Array.isArray(w.schemaDefinition) ? w.schemaDefinition : []) as SchemaDefinitionField[];
      const reason = attentionSentence({ ...event.attention, fieldNames: Object.fromEntries(fields.map((f) => [f.key, f.name])), runnable: event.runnable })
        ?? 'Something on this website needs you.';
      return { orgId: w.orgId, recipients: await orgLookouts(dbh, w.orgId, 'attention'), rendered: attentionEmail({ base, ...w, reason }) };
    }
    case 'run-failed': {
      const [r] = await dbh.select({ sourceId: runs.sourceId, status: runs.status, inputLabel: runs.inputLabel, errorMessage: runs.errorMessage })
        .from(runs).where(eq(runs.id, event.runId)).limit(1);
      // Spec §3.1, §7: only `failed`, never a sample.
      if (!r?.sourceId || r.status !== 'failed' || r.inputLabel === 'probe') return null;
      const w = await websitePlace(dbh, r.sourceId);
      if (!w) return null;
      return { orgId: w.orgId, recipients: await orgLookouts(dbh, w.orgId, 'failedRuns'), rendered: runFailedEmail({ base, ...w, runId: event.runId, stored: r.errorMessage }) };
    }
    case 'staff-access': {
      const org = await orgName(dbh, event.orgId);
      if (org === null) return null;
      const w = event.sourceId ? await websitePlace(dbh, event.sourceId) : null;
      const here = w && w.orgId === event.orgId ? w : null;
      return {
        orgId: event.orgId,
        // §4.5: never the operator who entered, even one who is a member of this org.
        recipients: await orgLookouts(dbh, event.orgId, null, event.actorUserId),
        rendered: staffAccessEmail({ base, org, website: here?.website ?? null, project: here?.project ?? null }),
      };
    }
    case 'role-changed':
    case 'removed': {
      const org = await orgName(dbh, event.orgId);
      // §4.1: only while they are a member — a removal is queued before its delete.
      const who = org === null ? null : await orgMember(dbh, event.orgId, event.userId);
      if (org === null || !who) return null;
      const rendered = event.kind === 'role-changed' ? roleChangedEmail({ base, org, role: event.role }) : removedEmail({ base, org });
      return { orgId: event.orgId, recipients: [who], rendered };
    }
  }
}

export async function queueEmails(dbh: DbOrTx, event: EmailEvent, opts: { env?: Env } = {}): Promise<{ queued: string[] }> {
  return dbh.transaction(async (tx) => {
    const built = await build(tx, event, publicAppUrl(opts.env));
    if (!built) return { queued: [] };
    const queued: string[] = [];
    for (const r of built.recipients) {
      const [row] = await tx.insert(emailMessages)
        .values({ orgId: built.orgId, userId: r.userId, kind: event.kind, dedupeKey: dedupeKey(event, r.userId), toAddress: r.email, ...built.rendered })
        .onConflictDoNothing({ target: emailMessages.dedupeKey })
        .returning({ id: emailMessages.id });
      if (!row) continue;
      await enqueue(tx, 'email', { messageId: row.id }, { key: emailJobKey(row.id) });
      queued.push(row.id);
    }
    return { queued };
  });
}

/**
 * Spec §4.3: mail never changes the run, Verify, check or mutation that caused it. Inside a caller's transaction a
 * failure undoes only this savepoint; the caller's writes go on.
 */
export async function queueEmailsSafely(dbh: DbOrTx, event: EmailEvent, opts: { env?: Env } = {}): Promise<number> {
  try {
    return (await queueEmails(dbh, event, opts)).queued.length;
  } catch (err) {
    console.error(`[email] ${event.kind} emails could not be queued:`, err);
    return 0;
  }
}
