// packages/api/src/email/send-email.ts
// The `email` job (spec 2026-10-24 email §3.3): sends one email_messages row from MAIL_FROM over SMTP_URL. Mail off
// (SMTP_URL empty) marks it skipped. A failed send is a failed attempt — recorded, thrown, retried with the job's
// backoff — and the fifth is final (`failed`). A row no longer queued (sent, skipped, failed, or gone with its org)
// is never sent again. Right before sending, the recipient must still be one (whyNotNow, §4.1), or the row is
// skipped with the reason. One message per job, so one recipient's failure never blocks another's. SMTP_URL's
// credentials never reach the stored error or the thrown one (redactSmtp).
import { and, eq } from 'drizzle-orm';
import { db, emailMessages } from '@robot/db';
import type { JobContext } from '../jobs/context.js';
import type { JobPayloads } from '../jobs/types.js';
import { mailFrom, smtpUrl, type Env } from './config.js';
import { SEND_TIMEOUT_MS, redactSmtp, sendSmtp } from './smtp.js';
import { whyNotNow } from './recipients.js';

/** JOB_POLICIES.email.maxAttempts — pinned equal by send-email.test.ts. */
export const EMAIL_ATTEMPTS = 5;

export class EmailNotSent extends Error {}

export async function sendEmailJob(
  p: JobPayloads['email'],
  ctx: Pick<JobContext, 'attempt'>,
  deps: { env?: Env; send?: typeof sendSmtp; timeoutMs?: number } = {},
): Promise<{ status: 'sent' | 'skipped' | 'none' }> {
  const env = deps.env ?? process.env;
  const [row] = await db.select().from(emailMessages).where(eq(emailMessages.id, p.messageId)).limit(1);
  if (!row || row.status !== 'queued') return { status: 'none' };
  const stillQueued = and(eq(emailMessages.id, row.id), eq(emailMessages.status, 'queued'));
  const url = smtpUrl(env);
  if (!url) {
    await db.update(emailMessages).set({ status: 'skipped' }).where(stillQueued);
    return { status: 'skipped' };
  }
  // Spec §4.1 at send time: a role, membership or preference may have changed since the row was queued.
  const why = await whyNotNow(db, row);
  if (why) {
    await db.update(emailMessages).set({ status: 'skipped', error: why }).where(stillQueued);
    return { status: 'skipped' };
  }
  try {
    await (deps.send ?? sendSmtp)(url, { from: mailFrom(env), to: row.toAddress, subject: row.subject, text: row.text, html: row.html }, deps.timeoutMs ?? SEND_TIMEOUT_MS);
  } catch (err) {
    const error = redactSmtp(err instanceof Error ? err.message : String(err), url).slice(0, 1000);
    const last = ctx.attempt >= EMAIL_ATTEMPTS;
    await db.update(emailMessages).set({ attempts: ctx.attempt, error, ...(last ? { status: 'failed' } : {}) }).where(stillQueued);
    throw new EmailNotSent(`email not sent: ${error}`);
  }
  await db.update(emailMessages).set({ status: 'sent', attempts: ctx.attempt, error: null, sentAt: new Date() }).where(eq(emailMessages.id, row.id));
  return { status: 'sent' };
}
