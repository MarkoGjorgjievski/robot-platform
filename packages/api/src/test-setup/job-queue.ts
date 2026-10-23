// Every api test enqueues and claims on its own queue, so no worker of Marko's (whose database the tests
// share) ever runs a test's job, no test claims his, and a test's in-process runner (withJobRunner,
// runQueuedJobs) never picks up a job another test of the same file left queued (final review I4).
// The file has a queue (module level and beforeAll work enqueue there); each test gets `<file queue>.<n>`.
// The file's jobs, all of its queues, are deleted after the file.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach } from 'vitest';

const fileQueue = `test-${randomUUID()}`;
process.env.JOB_QUEUE = fileQueue;
let n = 0;

beforeEach(() => { process.env.JOB_QUEUE = `${fileQueue}.${++n}`; });

afterAll(async () => {
  process.env.JOB_QUEUE = fileQueue;
  const { db } = await import('@robot/db');
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`DELETE FROM jobs WHERE queue = ${fileQueue} OR queue LIKE ${`${fileQueue}.%`}`);
});
