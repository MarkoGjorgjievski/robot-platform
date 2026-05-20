import type { FieldPathSet } from '@robot/scraper';

export type CachedFieldSummary = {
  name: string;
  type: string;
  description: string;
  required: true;
  example_value: string | undefined;
  tier: string | undefined;
  needsRediscovery: boolean;
};

function inferFieldType(fieldName: string): string {
  const name = fieldName.toLowerCase();
  if (name.includes('price') || name.includes('cost') || name.includes('discount_amount')) return 'price';
  if (name.includes('url') || name.includes('link') || name.includes('href')) return 'url';
  if (name.includes('image')) return 'image_url';
  if (name.includes('rating') || name.includes('count') || name.includes('number') || name.includes('review_count')) return 'number';
  if (name.includes('available') || name.includes('in_stock') || name.includes('is_')) return 'boolean';
  if (name.includes('date') || name.includes('time')) return 'date';
  if (name.includes('features') || name.includes('images') || name.includes('tags')) return 'array';
  return 'string';
}

export function cachedFieldsFromCache(
  fieldPaths: Record<string, FieldPathSet>,
  liveValues?: Record<string, unknown>,
): CachedFieldSummary[] {
  return Object.entries(fieldPaths).map(([name, pathSet]) => {
    const bestPath = [...pathSet.paths].sort((a, b) => {
      const aRate = a.hits + a.misses > 0 ? a.hits / (a.hits + a.misses) : a.confidence;
      const bRate = b.hits + b.misses > 0 ? b.hits / (b.hits + b.misses) : b.confidence;
      return bRate - aRate;
    })[0];
    const totalHits = bestPath?.hits ?? 0;
    const totalMisses = bestPath?.misses ?? 0;
    const hitRate = Math.round(totalHits / Math.max(1, totalHits + totalMisses) * 100);
    const liveValue = liveValues?.[name];
    const example = liveValue !== undefined && liveValue !== null
      ? String(liveValue).slice(0, 200)
      : (bestPath?.lastValue != null ? String(bestPath.lastValue).slice(0, 200) : undefined);
    return {
      name,
      type: inferFieldType(name),
      description: pathSet.paths.length === 0
        ? 'Cached field (discovered previously, awaiting re-discovery)'
        : `Cached field (${bestPath?.source ?? 'unknown'} source, ${hitRate}% hit rate)`,
      required: true,
      example_value: example,
      tier: undefined,
      needsRediscovery: pathSet.paths.length === 0,
    };
  });
}
