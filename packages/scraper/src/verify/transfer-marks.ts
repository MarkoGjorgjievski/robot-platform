// Pages 2 and 3 of the mark screen open with page 1's paths already run on
// them (spec 2026-09-18 §3.4): the same candidates verification would gather
// from page 1, tried on each other page in certification's order, stable paths
// first. Whatever resolves is shown with the element that displays it; the
// customer confirms or corrects. Nothing is certified here.
import type { CaptureLike } from './certify.js';
import { gatherCandidates, isVolatilePath, rankCertified, type CandidatePath } from './certify.js';
import type { Box } from './box-map.js';
import type { DomHit, DomNeedle, XPathProbeResult } from './dom-scripts.js';
import { normalize, valuesEqual } from './normalize.js';
import { resolveStructured } from './search-structured.js';
import { applyTransform } from './transforms.js';
import type { CertifiedSource, Mark, SchemaDefinitionField } from './types.js';

export type TransferInput = {
  field: SchemaDefinitionField;
  from: { url: string; capture: CaptureLike; expected: string; mark?: Mark };
  to: Record<string, { capture: CaptureLike; boxes: Box[] }>;
};
export type TransferDeps = {
  evalXPaths: (html: string, xpaths: string[]) => Promise<XPathProbeResult>;
  runDomSearch: (html: string, needles: DomNeedle[], pageUrl: string) => Promise<DomHit[]>;
};
export type Transferred = { value: string; via: { source: CertifiedSource; path: string }; boxes: number[] };

function boxValue(box: Box): string {
  return box.kind === 'image' ? box.src ?? '' : box.kind === 'link' ? box.href || box.text : box.text;
}

export async function transferMarks(input: TransferInput, deps: TransferDeps): Promise<Record<string, Transferred | null>> {
  const { field, from } = input;
  const gathered = await gatherCandidates(field, { [from.url]: from.expected }, { [from.url]: from.capture }, {
    runDomSearch: deps.runDomSearch,
    ...(from.mark ? { marks: { [from.url]: from.mark } } : {}),
  });
  // Certification's order, with the deploy-fragile XPaths last (certify.ts's stable-first rule).
  const ranked: CandidatePath[] = [...rankCertified(gathered.candidates.filter((c) => !isVolatilePath(c))), ...rankCertified(gathered.candidates.filter(isVolatilePath))];

  const out: Record<string, Transferred | null> = {};
  for (const [url, target] of Object.entries(input.to)) {
    const ctx = { pageUrl: target.capture.url };
    const xpaths = ranked.filter((c) => c.source === 'xpath').map((c) => c.path);
    const probe = xpaths.length ? await deps.evalXPaths(target.capture.html, xpaths) : {};
    let hit: Transferred | null = null;
    for (const c of ranked) {
      const rawBase = c.source === 'xpath' ? probe[c.path] ?? null : resolveStructured(target.capture, c.source, c.path);
      const raw = applyTransform(rawBase, c.transform);
      if (raw === null || raw === undefined || raw === '') continue;
      if (normalize(field.type, raw, ctx) === null) continue;               // a value the type rejects is not this field
      const value = Array.isArray(raw) ? raw.map(String).join(', ') : String(raw);
      const boxes = target.boxes.map((b, i) => (valuesEqual(field.type, boxValue(b), value, ctx) ? i : -1)).filter((i) => i >= 0);
      hit = { value, via: { source: c.source, path: c.path }, boxes };
      break;
    }
    out[url] = hit;
  }
  return out;
}
