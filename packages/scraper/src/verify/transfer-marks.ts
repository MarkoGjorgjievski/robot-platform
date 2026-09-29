// Pages 2 and 3 of the mark screen open with page 1's paths already run on
// them (spec 2026-09-18 §3.4): the same candidates verification would gather
// from page 1, tried on each other page in certification's order, stable paths
// first. Whatever resolves is shown with the element that displays it; the
// customer confirms or corrects. Nothing is certified here.
import type { CaptureLike } from './certify.js';
import { gatherCandidates, isVolatilePath, qualifiesForWeak, rankCertified, type CandidatePath } from './certify.js';
import type { Box } from './box-map.js';
import type { DomHit, DomNeedle, XPathProbeResult } from './dom-scripts.js';
import { isWeakField } from './field-fit.js';
import { normalize, valuesEqual } from './normalize.js';
import { resolveStructured } from './search-structured.js';
import { displayValue } from './structured-value.js';
import { applyTransform } from './transforms.js';
import type { CertifiedSource, ConfirmedPath, Mark, SchemaDefinitionField } from './types.js';

export type TransferInput = {
  field: SchemaDefinitionField;
  /** `via`: the structured path page 1's answer was accepted from (spec 2026-09-29 C1): it qualifies for a weak field and carries first. */
  from: { url: string; capture: CaptureLike; expected: string; mark?: Mark; via?: ConfirmedPath };
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
  // The path the customer confirmed on page 1 is always a candidate and carries first (spec 2026-09-29
  // A2 + C1, as certification ranks it); after it, certification's order, with the deploy-fragile
  // XPaths last (certify.ts's stable-first rule).
  const confirmed: ConfirmedPath[] = from.via ? [from.via] : [];
  const isConfirmed = (c: CandidatePath) => c.source !== 'xpath' && confirmed.some((p) => p.source === c.source && p.path === c.path);
  const firsts: CandidatePath[] = confirmed.map((p) =>
    gathered.candidates.find((c) => isConfirmed(c) && c.transform === 'identity') ?? gathered.candidates.find(isConfirmed) ?? { source: p.source, path: p.path, transform: 'identity' });
  const rest = gathered.candidates.filter((c) => !firsts.includes(c));
  const ranked: CandidatePath[] = [...firsts, ...rankCertified(rest.filter((c) => !isVolatilePath(c))), ...rankCertified(rest.filter(isVolatilePath))];
  // The carry follows C2 (spec 2026-09-29 A2): for a weak (boolean) field, a value match cannot
  // tell candidates apart, so only the mark's own XPath or a structured path that fits the
  // field's concept may carry — the same rule certification uses, so a tick on a yes/no field
  // never carries an unrelated field that happens to agree.
  const weak = isWeakField(field.type, [from.expected]);
  const eligible = weak ? ranked.filter((c) => qualifiesForWeak(field, c, { confirmed, markXPaths: from.mark?.xpaths })) : ranked;

  const out: Record<string, Transferred | null> = {};
  for (const [url, target] of Object.entries(input.to)) {
    const ctx = { pageUrl: target.capture.url };
    const xpaths = eligible.filter((c) => c.source === 'xpath').map((c) => c.path);
    const probe = xpaths.length ? await deps.evalXPaths(target.capture.html, xpaths) : {};
    let hit: Transferred | null = null;
    for (const c of eligible) {
      const rawBase = c.source === 'xpath' ? probe[c.path] ?? null : resolveStructured(target.capture, c.source, c.path);
      const raw = applyTransform(rawBase, c.transform);
      if (raw === null || raw === undefined || raw === '') continue;
      if (normalize(field.type, raw, ctx) === null) continue;               // a value the type rejects is not this field
      // spec 2026-09-29 C4: a structured object is read (its url/contentUrl/@id), never
      // stringified into "[object Object]" — displayValue is the one place that does this.
      // A candidate whose object has none of those is not a fit reading; try the next one.
      const value = displayValue(raw);
      if (value === null) continue;
      const boxes = target.boxes.map((b, i) => (valuesEqual(field.type, boxValue(b), value, ctx) ? i : -1)).filter((i) => i >= 0);
      hit = { value, via: { source: c.source, path: c.path }, boxes };
      break;
    }
    out[url] = hit;
  }
  return out;
}
