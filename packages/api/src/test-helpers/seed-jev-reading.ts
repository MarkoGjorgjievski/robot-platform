// A done Jev reading inserted directly, so the route smoke can read the shadow note
// without a TypeSafe request (spec 2026-10-16 §11). Cascades with the source.
import { db, jevReadings } from '@robot/db';

export async function seedJevReading(input: { sourceId: string; captureId: string; url: string; answers: unknown }): Promise<{ readingId: string }> {
  const [row] = await db.insert(jevReadings).values({ ...input, status: 'done', model: 'jev-1.14.0', inputTokens: 0, costUsd: '0', completedAt: new Date() })
    .onConflictDoUpdate({ target: jevReadings.captureId, set: { answers: input.answers, status: 'done' } })
    .returning({ id: jevReadings.id });
  return { readingId: row!.id };
}
