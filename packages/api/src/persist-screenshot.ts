// Screenshot persistence, extracted out of `routers/scraper.ts` (task 12)
// so `verify/run-source-verification.ts` can write verification-run
// screenshots to the exact same place — and in the exact same shape — as
// `sources.analyze` already does, instead of duplicating the write.

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function getCapturesDir(): string {
  // api-server sets CAPTURES_DIR before procedures run; fall back to a sensible default.
  return process.env.CAPTURES_DIR ?? join(process.cwd(), 'public', 'captures');
}

export async function persistScreenshot(screenshot: Buffer): Promise<{ id: string; url: string }> {
  const id = randomUUID();
  const dir = getCapturesDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.png`), screenshot);
  return { id, url: `/captures/${id}.png` };
}
