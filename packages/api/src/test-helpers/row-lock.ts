// Holds a website's row lock (`SELECT … FROM sources WHERE id = … FOR UPDATE`) in an open transaction until
// released, so a test can prove another caller waits on it. Fix wave 1, item 5.
import { eq } from 'drizzle-orm';
import { db, sources, sourceVerifications } from '@robot/db';

export type HeldLock = {
  /** Inserts an in-flight verification inside the lock-holding transaction (visible once released). */
  startVerifyInside: () => Promise<string>;
  release: () => Promise<void>;
};

export async function holdSourceLock(sourceId: string): Promise<HeldLock> {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let locked!: () => void;
  const isLocked = new Promise<void>((r) => { locked = r; });
  let txRef!: Parameters<Parameters<typeof db.transaction>[0]>[0];
  const done = db.transaction(async (tx) => {
    txRef = tx;
    await tx.select({ id: sources.id }).from(sources).where(eq(sources.id, sourceId)).for('update');
    locked();
    await gate;
  });
  await isLocked;
  return {
    startVerifyInside: async () => {
      const [row] = await txRef.insert(sourceVerifications).values({ sourceId, definitionHash: 'x' }).returning({ id: sourceVerifications.id });
      return row!.id;
    },
    release: async () => { release(); await done; },
  };
}

/** Whether a promise is still pending after `ms`. */
export async function stillPending(p: Promise<unknown>, ms = 300): Promise<boolean> {
  const marker = Symbol('pending');
  const r = await Promise.race([p.then(() => null, () => null), new Promise((res) => setTimeout(() => res(marker), ms))]);
  return r === marker;
}
