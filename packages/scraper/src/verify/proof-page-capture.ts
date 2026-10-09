// packages/scraper/src/verify/proof-page-capture.ts
// One proof page, captured for marking: `load` plus the proof-page ready
// check, the box map as the annotate script, six tiles. Refuses a redirect or
// a block page with the same reason verification would give.
import type { IBrowser, PageCapture } from '@robot/browser';
import { PROOF_PAGE_MAX_TILES } from './constants.js';
import { buildBoxMapScript, boxesFromAnnotation, type Box } from './box-map.js';
import { buildProofPageReadyCheck } from './proof-page-ready.js';
import { captureProblem, CaptureProblemError } from './capture-check.js';

export type ProofPageCapture = { capture: PageCapture; boxes: Box[] };

export async function captureProofPage(browser: IBrowser, url: string): Promise<ProofPageCapture> {
  const capture = await browser.capture(url, {
    waitUntil: 'load',
    interceptNetworkRequests: true,
    ready: buildProofPageReadyCheck(url),
    annotate: buildBoxMapScript(),
    maxTiles: PROOF_PAGE_MAX_TILES,
  });
  const problem = captureProblem(capture, url);
  if (problem) throw new CaptureProblemError(problem.reason, problem.verdict);
  return { capture, boxes: boxesFromAnnotation(capture.annotation) };
}
