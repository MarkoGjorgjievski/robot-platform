import type { FieldPathSet } from './domain-cache.js';

export type SchemaChange = {
  type: 'field_added' | 'field_removed' | 'field_degraded';
  fieldName: string;
  detail: string;
};

/**
 * Compare a fresh extraction's fields against the cached schema.
 * Detects new fields, removed fields, and degraded fields.
 */
export function detectSchemaChanges(
  cachedFieldPaths: Record<string, FieldPathSet>,
  freshFieldNames: string[],
  extractedData: Record<string, unknown>,
): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const cachedFields = new Set(Object.keys(cachedFieldPaths));
  const freshFields = new Set(freshFieldNames);

  // Fields in fresh extraction that aren't in cache → new fields
  for (const field of freshFields) {
    if (!cachedFields.has(field)) {
      const value = extractedData[field];
      changes.push({
        type: 'field_added',
        fieldName: field,
        detail: value != null ? `New field discovered (example: ${String(value).slice(0, 50)})` : 'New field discovered',
      });
    }
  }

  // Fields in cache that aren't in fresh extraction → potentially removed
  for (const field of cachedFields) {
    if (!freshFields.has(field)) {
      const pathSet = cachedFieldPaths[field];
      const totalUses = pathSet.paths.reduce((sum, p) => sum + p.hits + p.misses, 0);
      // Only flag if the field was previously well-established (>5 uses)
      if (totalUses > 5) {
        changes.push({
          type: 'field_removed',
          fieldName: field,
          detail: `Field no longer detected (was used ${totalUses} times)`,
        });
      }
    }
  }

  // Fields in both but with degraded paths → field degraded
  for (const field of freshFields) {
    if (!cachedFields.has(field)) continue;
    const pathSet = cachedFieldPaths[field];
    const value = extractedData[field];

    // Check if all paths have low hit rates
    const allDegraded = pathSet.paths.every(p => {
      const total = p.hits + p.misses;
      return total > 10 && (p.hits / total) < 0.5;
    });

    if (allDegraded && value === undefined) {
      changes.push({
        type: 'field_degraded',
        fieldName: field,
        detail: `All extraction paths below 50% hit rate`,
      });
    }
  }

  return changes;
}

/**
 * Format schema changes for logging or display.
 */
export function formatSchemaChanges(changes: SchemaChange[]): string {
  if (changes.length === 0) return 'No schema changes detected.';

  const lines = changes.map(c => {
    const icon = c.type === 'field_added' ? '➕' : c.type === 'field_removed' ? '❌' : '⚠️';
    return `  ${icon} ${c.fieldName}: ${c.detail}`;
  });

  return `Schema changes detected:\n${lines.join('\n')}`;
}
