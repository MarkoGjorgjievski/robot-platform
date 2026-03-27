import { db, domainIntelligence } from '@robot/db';
import { eq, and } from 'drizzle-orm';
import type { InterceptedRequest } from '@robot/browser';

// ─── Types ───────────────────────────────────────────────────────────────────

export type PathSource = 'api' | 'api-ai' | 'json-ld' | 'meta' | 'xpath' | 'xpath-cached';

/** A single extraction path for a field */
export type FieldPath = {
  path: string;
  source: PathSource;
  confidence: number;
  hits: number;
  misses: number;
  lastValue: unknown;
  lastUsedAt: string;
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
};

// ─── Lookup ──────────────────────────────────────────────────────────────────

export async function lookupDomainCache(domain: string, pageType: string): Promise<DomainCache | null> {
  const result = await db.query.domainIntelligence.findFirst({
    where: and(
      eq(domainIntelligence.domain, domain),
      eq(domainIntelligence.pageType, pageType),
    ),
  });

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
export function resolveFromCache(
  fieldPaths: Record<string, FieldPathSet>,
  allExtractedData: Record<string, unknown>,
  requestedFields: string[],
): { resolved: Record<string, ResolvedField>; overallConfidence: number } {
  const resolved: Record<string, ResolvedField> = {};

  for (const fieldName of requestedFields) {
    const pathSet = fieldPaths[fieldName];
    if (!pathSet || pathSet.paths.length === 0) continue;

    // Sort paths by hit rate (hits / (hits + misses)), then confidence
    const ranked = [...pathSet.paths].sort((a, b) => {
      const aRate = a.hits + a.misses > 0 ? a.hits / (a.hits + a.misses) : a.confidence;
      const bRate = b.hits + b.misses > 0 ? b.hits / (b.hits + b.misses) : b.confidence;
      return bRate - aRate;
    });

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

// ─── Save / Update ───────────────────────────────────────────────────────────

export type ExtractionOutcome = {
  domain: string;
  pageType: string;
  interceptedRequests: InterceptedRequest[];
  /** field name → { value, source, path, confidence } */
  fieldResults: Record<string, {
    value: unknown;
    source: PathSource;
    path: string;
    confidence: number;
  }>;
  overallConfidence: number;
  hasJsonLd: boolean;
  hasNextData: boolean;
};

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

  const isSuccess = outcome.overallConfidence >= 0.6;
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
    const mergedPaths = mergeFieldPaths(existingPaths, outcome.fieldResults, isSuccess, now);

    const newTotalRuns = (existing.totalRuns ?? 0) + 1;
    const newSuccessfulRuns = (existing.successfulRuns ?? 0) + (isSuccess ? 1 : 0);
    const newConsecutiveFailures = isSuccess ? 0 : (existing.consecutiveFailures ?? 0) + 1;

    // If consecutive failures exceed 5, reset the cache (site structure likely changed)
    const shouldReset = newConsecutiveFailures >= 5;

    await db
      .update(domainIntelligence)
      .set({
        apiEndpoints: shouldReset ? apiEndpoints : (existing.apiEndpoints ?? apiEndpoints),
        fieldPaths: shouldReset ? buildFreshPaths(outcome.fieldResults, now) : mergedPaths,
        hasJsonLd: outcome.hasJsonLd,
        hasNextData: outcome.hasNextData,
        totalRuns: shouldReset ? 1 : newTotalRuns,
        successfulRuns: shouldReset ? (isSuccess ? 1 : 0) : newSuccessfulRuns,
        consecutiveFailures: shouldReset ? 0 : newConsecutiveFailures,
        lastUsedAt: new Date(),
        lastVerifiedAt: isSuccess ? new Date() : existing.lastVerifiedAt,
        updatedAt: new Date(),
      })
      .where(eq(domainIntelligence.id, existing.id));

    if (shouldReset) {
      console.log(`[cache] Reset cache for ${outcome.domain}/${outcome.pageType} after ${newConsecutiveFailures} consecutive failures`);
    }
  } else {
    // First time — create fresh cache entry
    await db.insert(domainIntelligence).values({
      domain: outcome.domain,
      pageType: outcome.pageType,
      apiEndpoints,
      fieldPaths: buildFreshPaths(outcome.fieldResults, now),
      hasJsonLd: outcome.hasJsonLd,
      hasNextData: outcome.hasNextData,
      totalRuns: 1,
      successfulRuns: isSuccess ? 1 : 0,
      consecutiveFailures: isSuccess ? 0 : 1,
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mergeFieldPaths(
  existing: Record<string, FieldPathSet>,
  newResults: ExtractionOutcome['fieldResults'],
  isSuccess: boolean,
  now: string,
): Record<string, FieldPathSet> {
  const merged = { ...existing };

  for (const [fieldName, result] of Object.entries(newResults)) {
    if (!result.path && !result.value) continue;

    if (!merged[fieldName]) {
      merged[fieldName] = { paths: [], conflictCount: 0 };
    }

    const pathSet = merged[fieldName];

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

    // Prune dead paths (>10 misses, <10% hit rate)
    pathSet.paths = pathSet.paths.filter(p => {
      const total = p.hits + p.misses;
      if (total < 5) return true; // Too early to prune
      return p.hits / total > 0.1; // Keep if >10% hit rate
    });

    // Keep max 5 paths per field
    if (pathSet.paths.length > 5) {
      pathSet.paths.sort((a, b) => {
        const aRate = a.hits / Math.max(1, a.hits + a.misses);
        const bRate = b.hits / Math.max(1, b.hits + b.misses);
        return bRate - aRate;
      });
      pathSet.paths = pathSet.paths.slice(0, 5);
    }
  }

  return merged;
}

function buildFreshPaths(
  fieldResults: ExtractionOutcome['fieldResults'],
  now: string,
): Record<string, FieldPathSet> {
  const paths: Record<string, FieldPathSet> = {};

  for (const [fieldName, result] of Object.entries(fieldResults)) {
    if (!result.path && !result.value) continue;
    paths[fieldName] = {
      paths: [{
        path: result.path,
        source: result.source,
        confidence: result.confidence,
        hits: 1,
        misses: 0,
        lastValue: result.value,
        lastUsedAt: now,
      }],
      conflictCount: 0,
    };
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

function buildUrlPattern(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/[0-9a-f-]{8,}/gi, '/{id}');
    return `${parsed.origin}${path}`;
  } catch {
    return url;
  }
}
