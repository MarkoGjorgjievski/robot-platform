import type { PageCapture } from '@robot/browser';
import { MAX_CERTIFIED_PATHS } from './constants.js';
import { normalize, valuesEqual } from './normalize.js';
import { applyTransform } from './transforms.js';
import { resolveStructured, searchStructured } from './search-structured.js';
import { xpathContainsValue, type DomHit, type DomNeedle, type XPathProbeResult } from './dom-scripts.js';
import type { CellResult, CertifiedPath, FieldVerification, SchemaDefinitionField } from './types.js';

export type CandidatePath = CertifiedPath;
export type CaptureLike = Pick<PageCapture, 'url' | 'html' | 'structuredData' | 'interceptedRequests'>;
export type CertifyDeps = { evalXPaths: (html: string, xpaths: string[]) => Promise<XPathProbeResult> };
export type CertifyInput = {
  field: SchemaDefinitionField;
  expected: Record<string, string>;
  captures: Record<string, CaptureLike | null>;
  candidates: CandidatePath[];
};

const SOURCE_RANK: Record<CertifiedPath['source'], number> = { api: 0, 'json-ld': 1, meta: 2, xpath: 3 };

export function rankCertified(paths: CertifiedPath[]): CertifiedPath[] {
  return [...paths].sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || a.path.length - b.path.length);
}

function pathId(p: CandidatePath): string {
  return `${p.source} ${p.path} ${p.transform}`;
}

function dedupe(candidates: CandidatePath[]): CandidatePath[] {
  const seen = new Set<string>();
  return candidates.filter((c) => { const id = pathId(c); if (seen.has(id)) return false; seen.add(id); return true; });
}

export async function gatherCandidates(
  field: SchemaDefinitionField,
  expected: Record<string, string>,
  captures: Record<string, CaptureLike | null>,
  deps: { runDomSearch: (html: string, needles: DomNeedle[], pageUrl: string) => Promise<DomHit[]> },
): Promise<{ candidates: CandidatePath[]; hitsByUrl: Record<string, number> }> {
  const candidates: CandidatePath[] = [];
  const hitsByUrl: Record<string, number> = {};
  for (const [url, capture] of Object.entries(captures)) {
    if (!capture) continue;
    const exp = expected[url] ?? '';
    const structured = searchStructured(capture, field.type, exp);
    const dom = await deps.runDomSearch(capture.html, [{ key: field.key, type: field.type, expected: exp }], capture.url);
    hitsByUrl[url] = structured.length + dom.length;
    candidates.push(...structured.map((s) => ({ source: s.source, path: s.path, transform: s.transform })));
    candidates.push(...dom.map((h) => ({ source: 'xpath' as const, path: h.xpath, transform: 'identity' as const })));
  }
  return { candidates: dedupe(candidates), hitsByUrl };
}

type Eval = { raw: unknown; correct: boolean };

export async function certify(input: CertifyInput, deps: CertifyDeps): Promise<FieldVerification> {
  const { field, expected, captures } = input;
  const candidates = dedupe(input.candidates).filter((c) => c.source !== 'xpath' || !Object.values(expected).some((e) => xpathContainsValue(c.path, e)));
  const urls = Object.keys(captures);
  const capturedUrls = urls.filter((u) => captures[u] !== null);

  // Evaluate every candidate on every captured URL.
  const evals = new Map<string, Record<string, Eval>>(); // pathId → url → eval
  for (const url of capturedUrls) {
    const capture = captures[url]!;
    const ctx = { pageUrl: capture.url };
    const xpaths = candidates.filter((c) => c.source === 'xpath').map((c) => c.path);
    const probe = xpaths.length ? await deps.evalXPaths(capture.html, xpaths) : {};
    for (const c of candidates) {
      const rawBase = c.source === 'xpath' ? probe[c.path] ?? null : resolveStructured(capture, c.source, c.path);
      const raw = applyTransform(rawBase, c.transform);
      const correct = raw !== null && raw !== undefined && raw !== '' && valuesEqual(field.type, raw, expected[url] ?? '', ctx);
      if (!evals.has(pathId(c))) evals.set(pathId(c), {});
      evals.get(pathId(c))![url] = { raw, correct };
    }
  }

  const complete = capturedUrls.length === urls.length;
  const correctOnAllCaptured = candidates.filter((c) => capturedUrls.length > 0 && capturedUrls.every((u) => evals.get(pathId(c))?.[u]?.correct));
  const correctEverywhere = complete ? correctOnAllCaptured : [];
  const certified = rankCertified(correctEverywhere).slice(0, MAX_CERTIFIED_PATHS);
  const primary = certified[0];
  const rankedCorrectOnAllCaptured = rankCertified(correctOnAllCaptured);

  const cells: Record<string, CellResult> = {};
  for (const url of urls) {
    const capture = captures[url];
    if (!capture) { cells[url] = { status: 'not_captured' }; continue; }
    const ctx = { pageUrl: capture.url };
    if (primary) {
      const raw = evals.get(pathId(primary))![url]!.raw;
      cells[url] = { status: 'pass', found: String(raw), path: primary };
      continue;
    }
    if (!complete && rankedCorrectOnAllCaptured.length > 0) {
      const top = rankedCorrectOnAllCaptured[0]!;
      const raw = evals.get(pathId(top))![url]!.raw;
      cells[url] = { status: 'pass', found: String(raw), path: top };
      continue;
    }
    const others = capturedUrls.filter((u) => u !== url);
    const nearMisses = [...new Set(candidates.map((c) => evals.get(pathId(c))?.[url]?.raw).filter((r) => r !== null && r !== undefined && r !== '').map(String))].slice(0, 3);
    const twoOfThree = candidates.find((c) => others.length > 0 && others.every((u) => evals.get(pathId(c))?.[u]?.correct) && !evals.get(pathId(c))?.[url]?.correct);
    if (twoOfThree) {
      const here = evals.get(pathId(twoOfThree))![url]!.raw;
      const empty = here === null || here === undefined || here === '';
      if (empty) cells[url] = { status: 'fail', reason: 'not_found', ...(nearMisses.length ? { nearMisses } : {}) };
      else if (normalize(field.type, here, ctx) === null) cells[url] = { status: 'fail', reason: 'type_mismatch', found: String(here), ...(nearMisses.length ? { nearMisses } : {}) };
      else cells[url] = { status: 'fail', reason: 'different_value', found: String(here), ...(nearMisses.length ? { nearMisses } : {}) };
      continue;
    }
    const correctHere = candidates.some((c) => evals.get(pathId(c))?.[url]?.correct);
    cells[url] = correctHere
      ? { status: 'fail', reason: 'ambiguous', ...(nearMisses.length ? { nearMisses } : {}) }
      : { status: 'fail', reason: 'not_found', ...(nearMisses.length ? { nearMisses } : {}) };
  }

  const norms = new Set(Object.values(expected).map((e) => normalize(field.type, e)));
  return { key: field.key, cells, certified, weakEvidence: norms.size === 1 && Object.keys(expected).length > 1, aiCalled: false, incomplete: !complete };
}
