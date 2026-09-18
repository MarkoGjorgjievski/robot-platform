// packages/api/src/verify/capture-store.ts
// The capture sidecar files that live beside the screenshots in
// CAPTURES_DIR: `<captureId>.capture.json` is everything a later run needs to
// re-extract from a page without re-fetching it (html, structured data, the
// JSON API responses), and `persistTiles` writes a proof page's screenshot
// strips. Extracted from `run-source-verification.ts` so the proof-page
// capture job (proof-page-capture.ts) writes and reads the exact same files.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageCapture } from '@robot/browser';
import { CAPTURE_REUSE_MAX_AGE_MS } from '@robot/scraper';
import { persistScreenshot, getCapturesDir } from '../persist-screenshot.js';

export type StoredCaptureRef = { captureId: string; capturedAt: string; screenshotUrl?: string; blockedReason?: string };

export async function writeCaptureFile(captureId: string, c: PageCapture): Promise<void> {
  await mkdir(getCapturesDir(), { recursive: true });
  await writeFile(
    join(getCapturesDir(), `${captureId}.capture.json`),
    JSON.stringify({
      url: c.url,
      html: c.html,
      structuredData: c.structuredData,
      interceptedRequests: c.interceptedRequests.filter((r) => r.isJson && r.parsedJson !== null),
    }),
  );
}

/** Null on any problem: a missing or unreadable file just means "capture again". */
export async function readCaptureFile(captureId: string): Promise<PageCapture | null> {
  try {
    const raw = JSON.parse(await readFile(join(getCapturesDir(), `${captureId}.capture.json`), 'utf-8'));
    return { ...raw, markdown: '', title: '', timestamp: 0, screenshot: Buffer.alloc(0), screenshotTiles: [] } as PageCapture;
  } catch {
    return null;
  }
}

/** Null when the ref is older than a capture may be reused for, or its file is gone. */
export async function loadStoredCapture(ref: StoredCaptureRef): Promise<PageCapture | null> {
  if (Date.now() - Date.parse(ref.capturedAt) > CAPTURE_REUSE_MAX_AGE_MS) return null;
  return readCaptureFile(ref.captureId);
}

/** One `/captures/<id>.png` per tile, in the order the page was sliced. */
export async function persistTiles(tiles: Buffer[]): Promise<string[]> {
  const urls: string[] = [];
  for (const tile of tiles) urls.push((await persistScreenshot(tile)).url);
  return urls;
}
