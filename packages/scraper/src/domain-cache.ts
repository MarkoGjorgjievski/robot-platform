import { db, domainIntelligence } from '@robot/db';
import { eq, and } from 'drizzle-orm';
import { isThirdPartyNoise, type InterceptedRequest, type PaginationConfig } from '@robot/browser';
import { extractBrand } from './domain-utils.js';
import { sanitizeCatalogue, type CandidateCatalogue, type Candidate } from './candidate-catalogue.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type PathSource = 'api' | 'api-ai' | 'json-ld' | 'meta' | 'xpath' | 'xpath-cached' | 'human' | 'ai-vision' | 'ai-discovered-variants';

/** A single extraction path for a field */
export type FieldPath = {
  path: string;
  source: PathSource;
  confidence: number;
  hits: number;
  misses: number;
  lastValue: unknown;
  lastUsedAt: string;
  /** Operator-chosen path. Outranks every automatic signal and is never pruned. */
  pinned?: boolean;
  /** URL of the page this path last resolved on; conflict detection compares only same-page observations. */
  lastUrl?: string;
};

/** All paths for a single field, ranked by reliability */
export type FieldPathSet = {
  paths: FieldPath[];
  conflictCount: number;
};

/** The full cache entry for a domain + page type */
export type DomainCache = {
  id: string;
  domain: string;
  pageType: string;
  apiEndpoints: Array<{ url: string; urlPattern: string; method: string }>;
  fieldPaths: Record<string, FieldPathSet>;
  popupSelectors: string[];
  hasJsonLd: boolean;
  hasNextData: boolean;
  totalRuns: number;
  successfulRuns: number;
  consecutiveFailures: number;
  successRate: number;
  paginationConfig: PaginationConfig | null;
  rowSelector: { xpath: string; source: 'human'; setAt: string } | null;
  candidateCatalogue: CandidateCatalogue;
};

// ─── Lookup ──────────────────────────────────────────────────────────────────

export async function lookupDomainCache(domain: string, pageType: string): Promise<DomainCache | null> {
  // Try exact domain match first
  let result = await db.query.domainIntelligence.findFirst({
    where: and(
      eq(domainIntelligence.domain, domain),
      eq(domainIntelligence.pageType, pageType),
    ),
  });

  // If not found, try related domains (same brand, different TLD)
  if (!result) {
    const brand = extractBrand(domain);
    // Fetch all entries for this page type, then filter by exact brand match
    const candidates = await db
      .select()
      .from(domainIntelligence)
      .where(eq(domainIntelligence.pageType, pageType));

    const related = candidates
      .filter(c => extractBrand(c.domain) === brand && c.domain !== domain)
      .sort((a, b) => (b.successfulRuns ?? 0) - (a.successfulRuns ?? 0))[0];

    if (related) {
      console.log(`[cache] No cache for ${domain}, using related domain ${related.domain} (brand: ${brand})`);
      result = related;
    }
  }

  if (!result) return null;

  const totalRuns = result.totalRuns ?? 0;
  const successfulRuns = result.successfulRuns ?? 0;

  return {
    id: result.id,
    domain: result.domain,
    pageType: result.pageType,
    apiEndpoints: (result.apiEndpoints ?? []) as DomainCache['apiEndpoints'],
    fieldPaths: (result.fieldPaths ?? {}) as Record<string, FieldPathSet>,
    popupSelectors: (result.popupSelectors ?? []) as string[],
    hasJsonLd: result.hasJsonLd,
    hasNextData: result.hasNextData,
    totalRuns,
    successfulRuns,
    consecutiveFailures: result.consecutiveFailures ?? 0,
    successRate: totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 0,
    paginationConfig: (result.paginationConfig as PaginationConfig) ?? null,
    rowSelector: (result.rowSelector as DomainCache['rowSelector']) ?? null,
    candidateCatalogue: sanitizeCatalogue(result.candidateCatalogue),
  };
}

// ─── Resolve cached paths ────────────────────────────────────────────────────

export type ResolvedField = {
  name: string;
  value: unknown;
  source: PathSource;
  confidence: number;
  pathsAttempted: number;
  pathsSucceeded: number;
};

/**
 * Given cached field paths and fresh extracted data from all sources,
 * resolve each field by trying all known paths in priority order.
 * Cross-validates when multiple paths return values.
 */
/**
 * How much a source's claim about a field is worth, all else equal.
 *
 * Used ONLY to break statistical ties — hit rate still decides whenever the paths
 * have meaningfully different track records. The ordering reflects what each
 * source actually is:
 *
 *   human       an operator pinned it; nothing outranks that
 *   json-ld     the publisher DECLARING what this page's entity is
 *   meta        the same, in a weaker vocabulary
 *   xpath       what the page actually renders
 *   api         a dot-path guessed into an unlabelled blob, which may describe a
 *               different entity entirely (recommendations, config, other sellers)
 *   ai-vision   a model's reading of a picture
 *
 * Motivating case: on 2026-08-18 the www.newegg.com cache held two paths for
 * product_name with identical stats (hits 1, misses 0) — json-ld `name` with the
 * real title, and api `Configs[0].name` with a Newegg internal feature-flag label.
 * With source type carrying no weight, the tie fell to array order.
 */
const SOURCE_AUTHORITY: Record<PathSource, number> = {
  'human': 100,
  'json-ld': 80,
  'meta': 70,
  'xpath': 60,
  'xpath-cached': 55,
  'api': 40,
  'api-ai': 30,
  'ai-vision': 20,
  'ai-discovered-variants': 20,
};

export function sourceAuthority(source: PathSource | string): number {
  return SOURCE_AUTHORITY[source as PathSource] ?? 0;
}

/** Hit rates closer than this count as "the same track record". */
const SCORE_TIE_EPSILON = 1e-9;

export type PathConflict = {
  field: string;
  /** Competing values, best-ranked first — index 0 is what the cache would serve. */
  candidates: Array<{ source: PathSource; path: string; value: unknown; pinned: boolean }>;
};

/**
 * Fields whose stored paths currently disagree about the value.
 *
 * Deliberately recomputed rather than read from `conflictCount`. That counter is
 * monotonic — once a domain has ever had one disagreement it stays non-zero
 * forever — so it cannot answer "is anything wrong now?". It was also written and
 * never read anywhere, making it dead data.
 *
 * Reports only; per CLAUDE.md, degradation is flagged for human review and never
 * auto-reset. A poisoned path and a legitimately changed price look identical
 * from here.
 */
export function detectPathConflicts(fieldPaths: Record<string, FieldPathSet>, catalogue?: CandidateCatalogue): PathConflict[] {
  const conflicts: PathConflict[] = [];

  for (const [field, pathSet] of Object.entries(fieldPaths ?? {})) {
    const withValues = (pathSet?.paths ?? []).filter(
      (p) => p.lastValue !== null && p.lastValue !== undefined && p.lastValue !== '',
    );
    if (withValues.length < 2) continue;

    // A pin (or a human-sourced path) IS the operator's ruling on this exact
    // disagreement: the protected path serves, the losers are kept for the
    // record. Reporting it as a live conflict after the ruling tells the
    // operator their pin did nothing (2026-08-26: Newegg image_url stayed red
    // after being pinned). Unpinning re-arms the report.
    if (withValues.some(isProtectedPath)) continue;

    // Same-page observations only: two paths last exercised on different URLs
    // are telling you about staleness, not disagreement (triage class 4,
    // 2026-08-25 — AbeBooks' api path and xpath path held titles of two
    // different books). Rows predating lastUrl keep the old behaviour.
    const urls = new Set(withValues.map((p) => p.lastUrl).filter((u): u is string => !!u));
    if (urls.size > 1) continue;

    // Paths that map to DIFFERENT labelled candidates of a concept are the
    // catalogue working, not a conflict. Same-label disagreement still fires —
    // that is the poison signal this detector exists for.
    if (catalogue) {
      const labelOf = (p: FieldPath): string | null => {
        for (const candidates of Object.values(catalogue)) {
          const hit = candidates.find((c) => c.path === p.path);
          if (hit) return hit.label;
        }
        return null;
      };
      const labels = withValues.map(labelOf);
      const distinctKnown = new Set(labels.filter((l): l is string => l !== null));
      if (distinctKnown.size > 1 && labels.every((l) => l !== null)) continue;
    }

    const first = withValues[0]!.lastValue;
    if (withValues.every((p) => valuesMatch(p.lastValue, first))) continue;

    const ranked = [...withValues].sort(comparePaths);
    conflicts.push({
      field,
      candidates: ranked.map((p) => ({ source: p.source, path: p.path, value: p.lastValue, pinned: p.pinned === true })),
    });
  }

  return conflicts;
}

/**
 * Pin one of a field's cached paths, or clear the pin for that field.
 *
 * The conflict report tells a reviewer that two paths disagree; this is how they
 * act on it. Nothing is deleted — the losing path keeps its statistics and stays
 * visible, because a path that looks wrong today may simply reflect a site that
 * changed back tomorrow.
 *
 * Pass `path: null` to unpin. Returns false if the domain, field, or path is
 * unknown, so the caller can report a stale UI rather than silently no-op.
 */
export async function pinFieldPath(input: {
  domain: string;
  pageType: string;
  field: string;
  /** The `path` string of the candidate to pin, or null to clear. */
  path: string | null;
}): Promise<boolean> {
  const [row] = await db
    .select()
    .from(domainIntelligence)
    .where(and(
      eq(domainIntelligence.domain, input.domain),
      eq(domainIntelligence.pageType, input.pageType),
    ))
    .limit(1);
  if (!row) return false;

  const fieldPaths = (row.fieldPaths ?? {}) as Record<string, FieldPathSet>;
  const pathSet = fieldPaths[input.field];
  if (!pathSet || pathSet.paths.length === 0) return false;

  if (input.path !== null && !pathSet.paths.some((p) => p.path === input.path)) return false;

  // Exactly one pin per field — pinning a new candidate releases the previous one.
  for (const p of pathSet.paths) {
    p.pinned = input.path !== null && p.path === input.path;
  }

  await db
    .update(domainIntelligence)
    .set({ fieldPaths, updatedAt: new Date() })
    .where(and(
      eq(domainIntelligence.domain, input.domain),
      eq(domainIntelligence.pageType, input.pageType),
    ));

  console.log(
    input.path === null
      ? `[cache] unpinned ${input.domain}/${input.pageType} field "${input.field}"`
      : `[cache] pinned ${input.domain}/${input.pageType} field "${input.field}" to ${input.path}`,
  );
  return true;
}

/**
 * Record the displayed-verification judge's verdict for one concept.
 *
 * Mirrors `pinFieldPath`'s read-modify-write: exactly one candidate of the
 * concept may carry `displayed: true` (naming a new one clears it from every
 * other candidate), and every candidate of the concept — displayed or not —
 * is stamped with `verifiedAt` (now), since the judge looked at all of them
 * to reach its verdict. `label: null` records that the judge ran and found
 * no displayed candidate: only `verifiedAt` is stamped, `displayed` is
 * cleared on every candidate.
 *
 * A no-op (logged, not thrown) if the domain/page type or the concept is
 * unknown — catalogue data crosses a DB boundary and a stale caller must not
 * take the run down. Routes the modified catalogue through
 * `sanitizeCatalogue` before writing, same as `saveCandidateCatalogue`.
 */
export async function markDisplayed(
  domain: string, pageType: string, concept: string, label: string | null,
): Promise<void> {
  const [row] = await db
    .select()
    .from(domainIntelligence)
    .where(and(
      eq(domainIntelligence.domain, domain),
      eq(domainIntelligence.pageType, pageType),
    ))
    .limit(1);
  if (!row) {
    console.warn(`[cache] markDisplayed: no cache for ${domain}/${pageType}`);
    return;
  }

  const catalogue = sanitizeCatalogue(row.candidateCatalogue);
  const candidates = catalogue[concept];
  if (!candidates || candidates.length === 0) {
    console.warn(`[cache] markDisplayed: no concept "${concept}" for ${domain}/${pageType}`);
    return;
  }
  if (label !== null && !candidates.some((c) => c.label === label)) {
    console.warn(`[cache] markDisplayed: label "${label}" matches no candidate of "${concept}" for ${domain}/${pageType}`);
    return;
  }

  const now = new Date().toISOString();
  for (const c of candidates) {
    c.displayed = label !== null && c.label === label;
    c.verifiedAt = now;
  }

  const clean = sanitizeCatalogue(catalogue);
  await db
    .update(domainIntelligence)
    .set({ candidateCatalogue: clean, updatedAt: new Date() })
    .where(and(
      eq(domainIntelligence.domain, domain),
      eq(domainIntelligence.pageType, pageType),
    ));

  console.log(
    label === null
      ? `[cache] displayed-verification for ${domain}/${pageType} concept "${concept}": none displayed`
      : `[cache] displayed-verification for ${domain}/${pageType} concept "${concept}": ${label}`,
  );
}

/**
 * The page-type partition a pagination config belongs to. Pagination is a
 * property of listing pages; a detail page has none.
 */
const PAGINATION_PAGE_TYPE = 'listing';

/**
 * Store the pagination config that WORKED for a domain.
 *
 * Only ever called with a config whose walk verifiably produced new detail
 * URLs — a config that yields nothing is a false positive (a carousel arrow, a
 * selector for an element that is not there), and caching one would make every
 * later run on this domain replay a known-bad answer for free.
 *
 * There is no `null` case on purpose. A failed detection leaves whatever is
 * stored alone: absence of evidence is not evidence of absence, and a domain
 * with no config already behaves correctly by detecting from scratch.
 *
 * One config per domain, deliberately. A site whose search results and category
 * pages paginate differently will see the two overwrite each other; that is
 * visible in planRun's warnings, and the verify-then-replace rule means a wrong
 * config never survives a run that disproves it.
 */
export async function savePaginationConfig(domain: string, config: PaginationConfig): Promise<void> {
  await db
    .insert(domainIntelligence)
    .values({ domain, pageType: PAGINATION_PAGE_TYPE, paginationConfig: config })
    .onConflictDoUpdate({
      target: [domainIntelligence.domain, domainIntelligence.pageType],
      set: { paginationConfig: config, updatedAt: new Date() },
    });
  console.log(`[cache] pagination for ${domain}: ${config.strategy}`);
}

/** Write a freshly discovered catalogue. Sanitized on the way in; an empty
 *  sanitize result is still written (an explicit "nothing labelled" is data). */
export async function saveCandidateCatalogue(
  domain: string, pageType: string, catalogue: CandidateCatalogue,
): Promise<void> {
  const clean = sanitizeCatalogue(catalogue);
  await db
    .update(domainIntelligence)
    .set({ candidateCatalogue: clean, updatedAt: new Date() })
    .where(and(
      eq(domainIntelligence.domain, domain),
      eq(domainIntelligence.pageType, pageType),
    ));
  console.log(`[cache] candidate catalogue for ${domain}/${pageType}: ${Object.keys(clean).length} concept(s)`);
}

/** The refresh primitive: clear now, rebuild on the next successful extraction. */
export async function clearCandidateCatalogue(domain: string, pageType: string): Promise<void> {
  await db
    .update(domainIntelligence)
    .set({ candidateCatalogue: {}, updatedAt: new Date() })
    .where(and(
      eq(domainIntelligence.domain, domain),
      eq(domainIntelligence.pageType, pageType),
    ));
  console.log(`[cache] candidate catalogue cleared for ${domain}/${pageType}`);
}

/** Max automatic paths kept per field. Protected paths are additional to this. */
const MAX_PATHS_PER_FIELD = 5;

/**
 * A path the cache is not allowed to forget on its own.
 *
 * Both the dead-path prune and the five-path cap used to apply to every path
 * equally, so a `human` override — the one thing that is supposed to be
 * authoritative and permanent — could be silently deleted by a run of misses or
 * simply crowded out. That contradicts the "flag, never auto-reset" rule.
 */
function isProtectedPath(p: FieldPath): boolean {
  return p.pinned === true || p.source === 'human';
}

/**
 * Drop paths that have reliably stopped working, then cap the rest.
 *
 * Protected paths bypass both steps: an operator's decision is removed by an
 * operator, not by statistics.
 */
export function prunePaths(paths: FieldPath[]): FieldPath[] {
  const protectedPaths = paths.filter(isProtectedPath);
  const automatic = paths
    .filter((p) => !isProtectedPath(p))
    .filter((p) => {
      const total = p.hits + p.misses;
      if (total < 5) return true; // Too early to judge
      return p.hits / total > 0.1; // Keep if >10% hit rate
    })
    .sort(comparePaths)
    .slice(0, Math.max(0, MAX_PATHS_PER_FIELD - protectedPaths.length));

  return [...protectedPaths, ...automatic];
}

/** Shared ranking: pinned, then human, then track record, then source authority. */
function comparePaths(a: FieldPath, b: FieldPath): number {
  // An operator's explicit pin beats everything, including a human-sourced path
  // that was never pinned.
  if (a.pinned && !b.pinned) return -1;
  if (b.pinned && !a.pinned) return 1;
  if (a.source === 'human' && b.source !== 'human') return -1;
  if (b.source === 'human' && a.source !== 'human') return 1;
  const scoreDelta = pathScore(b) - pathScore(a);
  if (Math.abs(scoreDelta) > SCORE_TIE_EPSILON) return scoreDelta;
  return sourceAuthority(b.source) - sourceAuthority(a.source);
}

/** The concept a schema field maps to: explicit selection first, else the
 *  field's name matched against concept names (exact, then naive plural).
 *  Exported: the orchestrator's selection/displayed-default serving tier
 *  (task 7 fix round) needs the exact same field→concept resolution this
 *  file's own `resolveFromCache` uses, so both look up the same candidate. */
export function findConcept(
  catalogue: CandidateCatalogue,
  fieldName: string,
  selection?: { concept: string },
): Candidate[] | null {
  if (selection) return catalogue[selection.concept] ?? null;
  if (catalogue[fieldName]) return catalogue[fieldName]!;
  const singular = fieldName.replace(/s$/, '');
  return catalogue[singular] ?? null;
}

export function resolveFromCache(
  fieldPaths: Record<string, FieldPathSet>,
  allExtractedData: Record<string, unknown>,
  requestedFields: string[],
  opts?: { catalogue?: CandidateCatalogue; selections?: Record<string, { concept: string; label: string }> },
): { resolved: Record<string, ResolvedField>; overallConfidence: number } {
  const resolved: Record<string, ResolvedField> = {};

  for (const fieldName of requestedFields) {
    const pathSet = fieldPaths[fieldName];
    if (!pathSet || pathSet.paths.length === 0) continue;

    // Sort paths: human first, then by recency-weighted hit rate, then — only when
    // those tie — by how authoritative the source is about this page's entity.
    const ranked = [...pathSet.paths].sort(comparePaths);

    // v2.5 serving order (spec §6.1): the customer's own selection first, then
    // the vision-verified displayed candidate, then the statistical ranking.
    // A selection that maps to no catalogue entry (label renamed, catalogue
    // refreshed) degrades to the next rung and is logged — never a failure.
    const concept = opts?.catalogue ? findConcept(opts.catalogue, fieldName, opts?.selections?.[fieldName]) : null;
    const hoist = (predicate: (p: FieldPath) => boolean) => {
      const i = ranked.findIndex(predicate);
      if (i > 0) ranked.unshift(ranked.splice(i, 1)[0]!);
    };
    const selection = opts?.selections?.[fieldName];
    const selectedPath = selection && concept
      ? concept.find((c) => c.label === selection.label)?.path ?? null
      : null;
    if (selection && !selectedPath) {
      console.warn(`[cache] selection "${selection.concept}/${selection.label}" for field "${fieldName}" matches no catalogue candidate — serving default`);
    }
    // A pin (or a human-sourced path) must keep winning absent an explicit
    // selection (spec §6.1/§12): `comparePaths` above already sorted it to
    // the front, so the displayed-default hoist — which unconditionally
    // moves its match to index 0 — must not run at all when a protected path
    // exists, or it would bump the pin right back out of first place.
    const hasProtectedPath = pathSet.paths.some((p) => p.pinned || p.source === 'human');
    const displayedPath = hasProtectedPath ? null : (concept?.find((c) => c.displayed === true)?.path ?? null);
    if (displayedPath) hoist((p) => p.path === displayedPath);
    if (selectedPath) hoist((p) => p.path === selectedPath);

    // Try each path — collect all values that resolve
    const candidates: Array<{ value: unknown; path: FieldPath }> = [];
    for (const p of ranked) {
      const value = allExtractedData[fieldName] ?? allExtractedData[p.path];
      if (value !== undefined && value !== null && value !== '') {
        candidates.push({ value, path: p });
      }
    }

    if (candidates.length === 0) continue;

    // Cross-validation: do candidates agree?
    const primaryValue = candidates[0].value;
    const agreeing = candidates.filter(c => valuesMatch(c.value, primaryValue));
    const confidence = candidates.length > 1
      ? agreeing.length / candidates.length
      : candidates[0].path.confidence;

    resolved[fieldName] = {
      name: fieldName,
      value: primaryValue,
      source: candidates[0].path.source,
      confidence,
      pathsAttempted: ranked.length,
      pathsSucceeded: candidates.length,
    };
  }

  const fieldCount = requestedFields.length;
  const resolvedCount = Object.keys(resolved).length;
  const overallConfidence = fieldCount > 0 ? resolvedCount / fieldCount : 0;

  return { resolved, overallConfidence };
}

// ─── Resolve from API JSON using cached dot-notation paths ──────────────────

/**
 * Given cached API paths and raw intercepted API JSON,
 * resolve field values by following stored dot-notation paths.
 * This avoids AI calls on subsequent runs for the same domain.
 */
/**
 * All API JSON bodies worth searching for a field's value, excluding known
 * third-party noise (consent, analytics, A/B-test asset blobs) — their
 * product-shaped keys can poison cached paths (e.g. OneTrust's otFlat.json
 * publishes {"name":"otFlat",...}).
 *
 * Exported so every caller that resolves dot-paths against intercepted
 * requests — this file's own `resolveApiPathsFromCache` and the
 * orchestrator's selection/displayed-default serving tier (task 7 fix
 * round) — filters the same way instead of re-deriving it.
 */
export function collectApiJsonBodies(interceptedRequests: InterceptedRequest[]): Record<string, unknown>[] {
  return interceptedRequests
    .filter(r => r.parsedJson && typeof r.parsedJson === 'object')
    .filter(r => !isThirdPartyNoise(r.url))
    .map(r => r.parsedJson as Record<string, unknown>);
}

export function resolveApiPathsFromCache(
  fieldPaths: Record<string, FieldPathSet>,
  interceptedRequests: InterceptedRequest[],
  requestedFields: string[],
): { resolved: Record<string, ResolvedField>; overallConfidence: number } {
  const resolved: Record<string, ResolvedField> = {};

  const apiJsonBodies = collectApiJsonBodies(interceptedRequests);

  if (apiJsonBodies.length === 0) return { resolved, overallConfidence: 0 };

  for (const fieldName of requestedFields) {
    const pathSet = fieldPaths[fieldName];
    if (!pathSet || pathSet.paths.length === 0) continue;

    // Try API-sourced paths + human paths with API paths
    const apiPaths = pathSet.paths
      .filter(p => p.source === 'api' || p.source === 'api-ai' || (p.source === 'human' && !p.path.startsWith('//')))
      .sort((a, b) => {
        if (a.source === 'human' && b.source !== 'human') return -1;
        if (b.source === 'human' && a.source !== 'human') return 1;
        const aRate = a.hits + a.misses > 0 ? a.hits / (a.hits + a.misses) : a.confidence;
        const bRate = b.hits + b.misses > 0 ? b.hits / (b.hits + b.misses) : b.confidence;
        return bRate - aRate;
      });

    const candidates: Array<{ value: unknown; path: FieldPath }> = [];

    for (const p of apiPaths) {
      // Try each API body with this dot-notation path
      for (const body of apiJsonBodies) {
        const value = getByDotPath(body, p.path);
        if (value !== undefined && value !== null && value !== '') {
          candidates.push({ value, path: p });
          break; // Found in this body, no need to check others
        }
      }
    }

    if (candidates.length === 0) continue;

    const primaryValue = candidates[0].value;
    const agreeing = candidates.filter(c => valuesMatch(c.value, primaryValue));
    const confidence = candidates.length > 1
      ? agreeing.length / candidates.length
      : candidates[0].path.confidence;

    resolved[fieldName] = {
      name: fieldName,
      value: primaryValue,
      source: candidates[0].path.source,
      confidence,
      pathsAttempted: apiPaths.length,
      pathsSucceeded: candidates.length,
    };
  }

  const fieldCount = requestedFields.length;
  const resolvedCount = Object.keys(resolved).length;
  const overallConfidence = fieldCount > 0 ? resolvedCount / fieldCount : 0;

  return { resolved, overallConfidence };
}

// ─── Build cached XPath extraction script ───────────────────────────────────

/**
 * Build a Playwright evaluate() script from cached XPath paths.
 * Returns field values without needing AI to regenerate selectors.
 */
export function buildCachedXPathScript(
  fieldPaths: Record<string, FieldPathSet>,
  requestedFields: string[],
): { script: string; fieldNames: string[] } | null {
  const xpathFields: Array<{ name: string; xpath: string; attribute: string; transform: string }> = [];

  for (const fieldName of requestedFields) {
    const pathSet = fieldPaths[fieldName];
    if (!pathSet) continue;

    // Find best XPath path — human paths first, then by hit rate
    const xpathPath = pathSet.paths
      .filter(p => {
        if (p.source === 'ai-discovered-variants') return false;
        // variant_array fields' json-ld paths are also opaque cache keys, not in-page XPath
        if (p.path === 'ldJson[ProductGroup].hasVariant') return false;
        return p.source === 'xpath' || p.source === 'xpath-cached' || (p.source === 'human' && p.path.startsWith('//'));
      })
      .sort((a, b) => {
        if (a.source === 'human' && b.source !== 'human') return -1;
        if (b.source === 'human' && a.source !== 'human') return 1;
        const aRate = a.hits + a.misses > 0 ? a.hits / (a.hits + a.misses) : a.confidence;
        const bRate = b.hits + b.misses > 0 ? b.hits / (b.hits + b.misses) : b.confidence;
        return bRate - aRate;
      })[0];

    if (xpathPath) {
      xpathFields.push({
        name: fieldName,
        xpath: xpathPath.path,
        attribute: 'textContent',
        transform: 'trim',
      });
    }
  }

  if (xpathFields.length === 0) return null;

  const script = `
    (() => {
      function xpathQuery(xpath) {
        try {
          const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          return result.singleNodeValue;
        } catch (e) { return null; }
      }

      const fields = ${JSON.stringify(xpathFields)};
      const item = {};

      for (const field of fields) {
        try {
          const el = xpathQuery(field.xpath);
          if (!el) continue;
          let value = field.attribute === 'textContent'
            ? el.textContent?.trim() ?? null
            : el.getAttribute ? el.getAttribute(field.attribute) : null;
          if (value === null || value === '') continue;
          if (field.transform === 'parse_number') {
            const num = parseFloat(value.replace(/[^0-9.-]/g, ''));
            value = isNaN(num) ? null : num;
          }
          if (value !== null) item[field.name] = value;
        } catch {}
      }

      return { data: Object.keys(item).length > 0 ? [item] : [], fieldCount: Object.keys(item).length };
    })()
  `;

  return { script, fieldNames: xpathFields.map(f => f.name) };
}

/**
 * Navigate a JSON object using dot-notation path.
 * Supports array indexing: "data.items[0].price"
 */
export function getByDotPath(obj: unknown, path: string): unknown {
  const parts = path.split(/\.|\[(\d+)\]/).filter(Boolean);
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;

    const index = parseInt(part, 10);
    if (!isNaN(index) && Array.isArray(current)) {
      current = current[index];
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }

  return current;
}

// ─── Save / Update ───────────────────────────────────────────────────────────

export type ExtractionOutcome = {
  domain: string;
  pageType: string;
  /** URL of the page this outcome was extracted from; stamped onto each resolved path as `lastUrl`. */
  url: string;
  interceptedRequests: InterceptedRequest[];
  /** field name → { value, source, path, confidence } */
  fieldResults: Record<string, {
    value: unknown;
    source: PathSource;
    path: string;
    confidence: number;
  }>;
  /** All toggled-on field names for this schema, including those that did not resolve — ensures the cache tracks existence even without a path. */
  discoveredFieldNames: string[];
  overallConfidence: number;
  hasJsonLd: boolean;
  hasNextData: boolean;
};

/**
 * An extraction counts as "successful" at 30% field coverage — flexible
 * enough for partial extractions to still enrich the cache. Named and
 * exported so every caller that needs the cache's own definition of success
 * (the discovery trigger in `extraction-orchestrator.ts` among them) reads
 * this constant rather than re-deriving or hardcoding the threshold.
 */
export const EXTRACTION_SUCCESS_THRESHOLD = 0.3;

/**
 * Save extraction results to domain intelligence.
 * Merges new paths into existing cache — never overwrites, only enriches.
 */
export async function saveDomainCache(outcome: ExtractionOutcome): Promise<void> {
  const existing = await db.query.domainIntelligence.findFirst({
    where: and(
      eq(domainIntelligence.domain, outcome.domain),
      eq(domainIntelligence.pageType, outcome.pageType),
    ),
  });

  // Success threshold: at least 30% of fields found (flexible for partial extractions)
  const isSuccess = outcome.overallConfidence >= EXTRACTION_SUCCESS_THRESHOLD;
  const now = new Date().toISOString();

  // Build API endpoint list
  const apiEndpoints = outcome.interceptedRequests.slice(0, 10).map(req => ({
    url: req.url,
    urlPattern: buildUrlPattern(req.url),
    method: req.method,
  }));

  if (existing) {
    // Merge new paths into existing cache
    const existingPaths = (existing.fieldPaths ?? {}) as Record<string, FieldPathSet>;
    const mergedPaths = mergeFieldPaths(existingPaths, outcome.fieldResults, outcome.discoveredFieldNames, isSuccess, now, outcome.url);

    const newTotalRuns = (existing.totalRuns ?? 0) + 1;
    const newSuccessfulRuns = (existing.successfulRuns ?? 0) + (isSuccess ? 1 : 0);
    const newConsecutiveFailures = isSuccess ? 0 : (existing.consecutiveFailures ?? 0) + 1;

    // Flag degradation but NEVER auto-reset — human review required
    if (newConsecutiveFailures >= 5) {
      console.warn(`[cache] ⚠ ${outcome.domain}/${outcome.pageType} has ${newConsecutiveFailures} consecutive failures — flagged for human review`);
    }

    // Same rule for disagreement: report, never resolve it automatically. Two
    // paths returning different values is how a poisoned path announces itself,
    // and until now the cache detected it (conflictCount) and told nobody.
    for (const conflict of detectPathConflicts(mergedPaths, sanitizeCatalogue(existing.candidateCatalogue))) {
      const shown = conflict.candidates
        .map((c) => `${c.source}=${String(JSON.stringify(c.value)).slice(0, 40)}`)
        .join(' vs ');
      console.warn(`[cache] ⚠ ${outcome.domain}/${outcome.pageType} field "${conflict.field}" has disagreeing paths — serving ${conflict.candidates[0]!.source}: ${shown}`);
    }

    await db
      .update(domainIntelligence)
      .set({
        apiEndpoints: existing.apiEndpoints ?? apiEndpoints,
        fieldPaths: mergedPaths,
        hasJsonLd: outcome.hasJsonLd,
        hasNextData: outcome.hasNextData,
        totalRuns: newTotalRuns,
        successfulRuns: newSuccessfulRuns,
        consecutiveFailures: newConsecutiveFailures,
        lastUsedAt: new Date(),
        lastVerifiedAt: isSuccess ? new Date() : existing.lastVerifiedAt,
        updatedAt: new Date(),
      })
      .where(eq(domainIntelligence.id, existing.id));
  } else {
    // First time — create fresh cache entry
    await db.insert(domainIntelligence).values({
      domain: outcome.domain,
      pageType: outcome.pageType,
      apiEndpoints,
      fieldPaths: buildFreshPaths(outcome.fieldResults, outcome.discoveredFieldNames, now, outcome.url),
      hasJsonLd: outcome.hasJsonLd,
      hasNextData: outcome.hasNextData,
      totalRuns: 1,
      successfulRuns: isSuccess ? 1 : 0,
      consecutiveFailures: isSuccess ? 0 : 1,
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function mergeFieldPaths(
  existing: Record<string, FieldPathSet>,
  newResults: ExtractionOutcome['fieldResults'],
  discoveredFieldNames: string[],
  isSuccess: boolean,
  now: string,
  lastUrl?: string,
): Record<string, FieldPathSet> {
  const merged = { ...existing };

  for (const [fieldName, result] of Object.entries(newResults)) {
    if (!result.path && !result.value) continue;

    if (!merged[fieldName]) {
      merged[fieldName] = { paths: [], conflictCount: 0 };
    }

    const pathSet = merged[fieldName];

    // AI-description sources use prose as their "path", so every re-discovery
    // words it differently and the cache accretes near-duplicates (five for
    // Newegg variants by 2026-08-25). Identity for them is the SOURCE: a new
    // description replaces the old one in place, stats carried forward.
    if (result.source === 'ai-discovered-variants') {
      const prior = pathSet.paths.find(p => p.source === 'ai-discovered-variants');
      if (prior) {
        prior.path = result.path;
        prior.lastValue = result.value;
        prior.lastUsedAt = now;
        if (lastUrl) prior.lastUrl = lastUrl;
        prior.hits += 1;
        continue;
      }
    }

    // Find existing path with same source + path
    const existingPath = pathSet.paths.find(
      p => p.source === result.source && p.path === result.path
    );

    if (existingPath) {
      // Update existing path stats
      if (isSuccess && result.value !== null && result.value !== undefined) {
        existingPath.hits++;
        existingPath.lastValue = result.value;
        existingPath.confidence = Math.min(1, existingPath.confidence + 0.02);
      } else {
        existingPath.misses++;
        existingPath.confidence = Math.max(0, existingPath.confidence - 0.05);
      }
      existingPath.lastUsedAt = now;
      if (lastUrl) existingPath.lastUrl = lastUrl;
    } else if (result.path) {
      // Add new path
      pathSet.paths.push({
        path: result.path,
        source: result.source,
        confidence: result.confidence,
        hits: isSuccess ? 1 : 0,
        misses: isSuccess ? 0 : 1,
        lastValue: result.value,
        lastUsedAt: now,
        ...(lastUrl ? { lastUrl } : {}),
      });
    }

    // Check for value conflicts across paths
    const values = pathSet.paths
      .filter(p => p.lastValue !== null && p.lastValue !== undefined)
      .map(p => p.lastValue);
    if (values.length > 1) {
      const allMatch = values.every(v => valuesMatch(v, values[0]));
      if (!allMatch) pathSet.conflictCount++;
    }

    pathSet.paths = prunePaths(pathSet.paths);
  }

  // Empty-path entries skip the prune loop above by construction (it only iterates newResults).
  for (const fieldName of discoveredFieldNames) {
    if (!merged[fieldName]) {
      merged[fieldName] = { paths: [], conflictCount: 0 };
    }
  }

  return merged;
}

function buildFreshPaths(
  fieldResults: ExtractionOutcome['fieldResults'],
  discoveredFieldNames: string[],
  now: string,
  lastUrl?: string,
): Record<string, FieldPathSet> {
  const paths: Record<string, FieldPathSet> = {};

  for (const [fieldName, result] of Object.entries(fieldResults)) {
    // Only cache results that carry a reusable path. Path-less results (e.g. the
    // 'ai-vision' fallback, which delivers a value the AI read off the screenshot
    // but has no selector) are recorded as field-existence via discoveredFieldNames
    // below — never as a bogus empty-string path. Mirrors mergeFieldPaths.
    if (!result.path) continue;
    paths[fieldName] = {
      paths: [{
        path: result.path,
        source: result.source,
        confidence: result.confidence,
        hits: 1,
        misses: 0,
        lastValue: result.value,
        lastUsedAt: now,
        ...(lastUrl ? { lastUrl } : {}),
      }],
      conflictCount: 0,
    };
  }

  for (const fieldName of discoveredFieldNames) {
    if (!paths[fieldName]) {
      paths[fieldName] = { paths: [], conflictCount: 0 };
    }
  }

  return paths;
}

function valuesMatch(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const strA = String(a).trim().toLowerCase();
  const strB = String(b).trim().toLowerCase();
  if (strA === strB) return true;
  // Numeric comparison with tolerance (for prices)
  const numA = parseFloat(strA.replace(/[^0-9.-]/g, ''));
  const numB = parseFloat(strB.replace(/[^0-9.-]/g, ''));
  if (!isNaN(numA) && !isNaN(numB)) {
    return Math.abs(numA - numB) / Math.max(numA, numB) < 0.05; // 5% tolerance
  }
  return false;
}

/**
 * Score a path for ranking. Uses hit rate as the primary signal.
 *
 * Recency is only used as a TIEBREAKER between paths with similar hit rates,
 * NOT as a penalty for inactivity. A path that worked 4 months ago but has
 * 98% hit rate is still trusted — it just hasn't been needed recently.
 *
 * Decay only kicks in when a path has RECENT MISSES (evidence of degradation).
 */
function pathScore(path: FieldPath): number {
  const total = path.hits + path.misses;
  if (total === 0) return path.confidence;

  const hitRate = path.hits / total;

  // Only apply recency penalty if the path has recent failures
  // A path with 0 misses should never be penalized for inactivity
  if (path.misses === 0) return hitRate;

  // For paths WITH misses: weight recent activity higher
  // If the path was used recently and failed, that's a stronger signal
  // than an old failure from months ago
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeksSinceUse = path.lastUsedAt
    ? (Date.now() - new Date(path.lastUsedAt).getTime()) / msPerWeek
    : 52; // old paths with misses: give them benefit of doubt (maybe site was fixed)

  // Recent misses are worse than old misses
  // If last use was recent AND there are misses → lower score
  // If last use was old AND there are misses → misses may be stale, trust hit rate more
  const recencyWeight = weeksSinceUse < 2 ? 1.0 : 0.5; // recent misses count full, old misses count half
  const adjustedMisses = path.misses * recencyWeight;
  const adjustedTotal = path.hits + adjustedMisses;

  return adjustedTotal > 0 ? path.hits / adjustedTotal : hitRate;
}

function buildUrlPattern(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/[0-9a-f-]{8,}/gi, '/{id}');
    return `${parsed.origin}${path}`;
  } catch {
    return url;
  }
}
