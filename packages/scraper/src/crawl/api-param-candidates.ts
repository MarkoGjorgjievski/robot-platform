// Which query parameter pages this endpoint, and by how much?
//
// The same question `deriveTemplate` gets wrong on the HTML path: on 2026-08-21
// it chose AbeBooks' `ds` filter and pinned `p=1`, the real pager, so pages 2 and
// 3 re-served page 1 — and three stray items past dedupe were enough to satisfy
// the `gained > 0` gate, so the broken config was cached in silence.
//
// The difference here is that we can settle it by experiment. This module only
// RANKS and DECIDES; the fetching happens elsewhere, so every judgement below is
// a pure function over values a test can hand it.

/** Names that page, best guess first. A name outside this list is noise, not a candidate. */
const PAGE_STYLE = ['page', 'pageNumber', 'pageNum', 'p'] as const;
const OFFSET_STYLE = ['offset', 'start', 'startIndex', 'from', 'skip'] as const;
const RANKED: readonly string[] = [...PAGE_STYLE, ...OFFSET_STYLE];

/** Above this share of page 1's identifiers coming back, the hypothesis is wrong. */
export const REPLAY_MAX_OVERLAP = 0.5;

export type Candidate = {
  paramName: string;
  /** The value the parameter holds on page 1. */
  from: number;
  /** How much to advance it by for the next page. */
  step: number;
};

export function rankCandidates(endpointUrl: string, pageSize: number): Candidate[] {
  const params = new URL(endpointUrl).searchParams;
  const out: Candidate[] = [];
  for (const name of RANKED) {
    const raw = params.get(name);
    if (raw === null || !/^\d+$/.test(raw)) continue;
    const from = Number(raw);
    // The step is part of the hypothesis. Name-implied first, the other second —
    // an offset bumped by 1 (or a page bumped by 30) parses perfectly and returns
    // an overlapping window, which only a replay can tell apart from a real page.
    const implied = (PAGE_STYLE as readonly string[]).includes(name) ? 1 : pageSize;
    const other = implied === 1 ? pageSize : 1;
    out.push({ paramName: name, from, step: implied });
    if (other !== implied && other > 0) out.push({ paramName: name, from, step: other });
  }
  return out;
}

/** The endpoint with `c.paramName` advanced one page, everything else untouched. */
export function probeUrl(endpointUrl: string, c: Candidate): string {
  const url = new URL(endpointUrl);
  url.searchParams.set(c.paramName, String(c.from + c.step));
  return url.toString();
}

/** The endpoint with `paramName`'s value replaced by the {N} placeholder. */
export function templateFor(endpointUrl: string, paramName: string): string {
  const url = new URL(endpointUrl);
  url.searchParams.set(paramName, '__N__');
  return url.toString().replace('__N__', '{N}');
}

/**
 * What share of page 1's identifiers came back in the probe.
 *
 * Measured against PAGE 1's set, not the probe's: a probe returning page 1's
 * thirty items plus ten new ones is still re-serving page 1, and dividing by the
 * probe's larger set would hide that.
 */
export function overlapShare(page1Ids: string[], probeIds: string[]): number {
  if (page1Ids.length === 0) return 0;
  const probe = new Set(probeIds);
  const repeated = new Set(page1Ids.filter((id) => probe.has(id)));
  return repeated.size / new Set(page1Ids).size;
}
