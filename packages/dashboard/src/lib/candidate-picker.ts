/**
 * The candidate catalogue shape, duplicated from `@robot/scraper`'s
 * `candidate-catalogue.ts` — the dashboard package cannot import `@robot/scraper`
 * (controller ruling R2 accepts this small duplication). Keep in sync by hand;
 * both sides carry tests pinning the plural rule.
 */
export type Candidate = {
  label: string;
  source: string;
  path: string;
  sampleValue: unknown;
  scope?: Record<string, string>;
  displayed?: boolean;
  verifiedAt?: string;
};

export type CandidateCatalogue = Record<string, Candidate[]>;

export type PickerOption = {
  concept: string;
  label: string;
  sampleValue: unknown;
  displayed: boolean;
  scope?: Record<string, string>;
  selected: boolean;
};

/**
 * The concept a schema field maps to: explicit ref first, else the field's
 * name matched against concept names (exact, then naive singular by
 * stripping a trailing "s"). Mirrors the scraper's `findConcept` in
 * `domain-cache.ts` — both must resolve field -> concept identically or a
 * picker's selection would silently diverge from what serving actually uses.
 */
function findConcept(
  catalogue: CandidateCatalogue,
  fieldName: string,
  explicitConcept?: string,
): { concept: string; candidates: Candidate[] } | null {
  if (explicitConcept) {
    const candidates = catalogue[explicitConcept];
    return candidates ? { concept: explicitConcept, candidates } : null;
  }
  if (catalogue[fieldName]) return { concept: fieldName, candidates: catalogue[fieldName]! };
  const singular = fieldName.replace(/s$/, '');
  return catalogue[singular] ? { concept: singular, candidates: catalogue[singular]! } : null;
}

/**
 * Which options to offer for one schema field's candidate picker, and null
 * when no picker is warranted (fewer than 2 candidates for the field's
 * concept). Displayed-first ordering; `current` (an existing explicit
 * selection) marks the matching option `selected`.
 */
export function pickerOptions(
  catalogue: CandidateCatalogue,
  fieldName: string,
  current?: { concept: string; label: string },
): PickerOption[] | null {
  const resolved = findConcept(catalogue, fieldName, current?.concept);
  if (!resolved || resolved.candidates.length < 2) return null;

  const sorted = [...resolved.candidates].sort((a, b) => {
    if (a.displayed && !b.displayed) return -1;
    if (b.displayed && !a.displayed) return 1;
    return 0;
  });

  return sorted.map((c) => ({
    concept: resolved.concept,
    label: c.label,
    sampleValue: c.sampleValue,
    displayed: c.displayed === true,
    scope: c.scope,
    selected: current?.concept === resolved.concept && current?.label === c.label,
  }));
}
