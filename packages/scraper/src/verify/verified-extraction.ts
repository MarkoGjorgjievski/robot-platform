// packages/scraper/src/verify/verified-extraction.ts
// Certified-only extraction at scale: given a Source's certified paths (Task
// 8's runVerification output, loaded per-run by loadCurrentCertification),
// this evaluates ONLY those paths against a live page — never the cache/AI
// extraction chain, never a fresh search. A path that no longer resolves is
// an honest miss (null in the row, drift's raw material) — not a cue to fall
// back to anything else.

import type { IBrowser, PageCapture } from '@robot/browser';
import { normalize, renderValue } from './normalize.js';
import { applyTransform } from './transforms.js';
import { resolveStructured } from './search-structured.js';
import { buildXPathProbeScript, type XPathProbeResult } from './dom-scripts.js';
import type { CertifiedPath, CustomerFieldType } from './types.js';

export type VerifiedField = { key: string; type: CustomerFieldType; concept: string; paths: CertifiedPath[] };
export type VerifiedExtractionResult = {
  data: Record<string, unknown>;
  stats: Array<{ key: string; concept: string; path: CertifiedPath; hit: boolean; value?: unknown }>;
};

export async function runVerifiedExtraction(
  req: { url: string; fields: VerifiedField[] },
  deps: { browser: IBrowser; capture?: PageCapture },
): Promise<VerifiedExtractionResult> {
  const capture = deps.capture ?? await deps.browser.capture(req.url, { waitUntil: 'networkidle', interceptNetworkRequests: true });
  const xpaths = [...new Set(req.fields.flatMap((f) => f.paths.filter((p) => p.source === 'xpath').map((p) => p.path)))];
  const probe: XPathProbeResult = xpaths.length ? await deps.browser.setContentEvaluate<XPathProbeResult>(capture.html, buildXPathProbeScript(xpaths)) : {};
  const ctx = { pageUrl: capture.url };
  const data: Record<string, unknown> = {};
  const stats: VerifiedExtractionResult['stats'] = [];
  for (const f of req.fields) {
    data[f.key] = null;
    for (const p of f.paths) {
      const rawBase = p.source === 'xpath' ? probe[p.path] ?? null : resolveStructured(capture, p.source, p.path);
      const raw = applyTransform(rawBase, p.transform);
      const norm = raw === null || raw === undefined || raw === '' ? null : normalize(f.type, raw, ctx);
      if (norm === null) { stats.push({ key: f.key, concept: f.concept, path: p, hit: false }); continue; }
      const value = f.type === 'text' ? String(raw).normalize('NFKC').replace(/\s+/g, ' ').trim() : renderValue(f.type, norm);
      data[f.key] = value;
      stats.push({ key: f.key, concept: f.concept, path: p, hit: true, value });
      break;
    }
  }
  return { data, stats };
}
