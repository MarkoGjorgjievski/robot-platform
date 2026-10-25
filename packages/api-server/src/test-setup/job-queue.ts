// Every api test file enqueues and claims on its own queue, so no worker of Marko's (whose database the
// tests share) ever runs a test's job, and no test claims his. Its jobs are deleted after the file, and its workers
// rows (a killed test worker leaves one).
import { randomUUID } from 'node:crypto';
import { afterAll } from 'vitest';

process.env.JOB_QUEUE = `test-${randomUUID()}`;

afterAll(async () => {
  const { db } = await import('@robot/db');
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`DELETE FROM jobs WHERE queue = ${process.env.JOB_QUEUE!}`);
  await db.execute(sql`DELETE FROM workers WHERE queue = ${process.env.JOB_QUEUE!}`);
});
