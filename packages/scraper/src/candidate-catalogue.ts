/**
 * The candidate catalogue: what one domain CAN yield for one concept.
 * Discovered once per domain (spec §4), cached on domain_intelligence,
 * refreshed only on operator request. The catalogue never serves values —
 * serving stays in field_paths; this is the map from meaning to path.
 */

/** Semantic family, snake_case singular: "price", "rating", "review_count". */
export type ConceptName = string;

export type Candidate = {
  /** Short distinctive label within the concept: "displayed", "list", "yotpo". */
  label: string;
  /** Same vocabulary as FieldPath.source. */
  source: string;
  /** Dot-path or XPath — the path language field_paths already speaks. */
  path: string;
  /** Value observed when the catalogue was built; display only, never served. */
  sampleValue: unknown;
  /** Scope facts that make the value interpretable (label-only in v2.5). */
  scope?: Record<string, string>;
  /** Set by displayed-verification; at most one true per concept. */
  displayed?: boolean;
  /** When displayed-verification last ran for this concept (ISO). */
  verifiedAt?: string;
};

export type CandidateCatalogue = Record<ConceptName, Candidate[]>;

export const MAX_CANDIDATES_PER_CONCEPT = 8;

/**
 * Never throws: catalogue data crosses an AI boundary and a DB boundary, and a
 * malformed entry must cost the entry, not the extraction.
 */
export function sanitizeCatalogue(raw: unknown): CandidateCatalogue {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: CandidateCatalogue = {};
  for (const [concept, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const seen = new Set<string>();
    let displayedTaken = false;
    const kept: Candidate[] = [];
    for (const entry of value) {
      if (kept.length >= MAX_CANDIDATES_PER_CONCEPT) break;
      if (entry === null || typeof entry !== 'object') continue;
      const c = entry as Record<string, unknown>;
      if (typeof c.label !== 'string' || c.label.length === 0) continue;
      if (typeof c.source !== 'string' || typeof c.path !== 'string' || c.path.length === 0) continue;
      if (seen.has(c.label)) continue;
      seen.add(c.label);
      const candidate: Candidate = {
        label: c.label, source: c.source, path: c.path, sampleValue: c.sampleValue,
      };
      if (c.scope && typeof c.scope === 'object' && !Array.isArray(c.scope)) {
        candidate.scope = c.scope as Record<string, string>;
      }
      if (c.displayed === true && !displayedTaken) {
        candidate.displayed = true;
        displayedTaken = true;
      }
      if (typeof c.verifiedAt === 'string') candidate.verifiedAt = c.verifiedAt;
      kept.push(candidate);
    }
    if (kept.length > 0) out[concept] = kept;
  }
  return out;
}
