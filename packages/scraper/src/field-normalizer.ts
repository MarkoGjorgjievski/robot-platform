import type { SchemaField, FieldType } from '@robot/agent';

/**
 * Normalize freeform user field input into structured SchemaField[].
 * Accepts comma-separated or newline-separated field names.
 * Supports "field_name - description" format.
 */
export function normalizeUserFields(input: string): SchemaField[] {
  if (!input.trim()) return [];

  // Split on commas or newlines
  const separator = input.includes('\n') ? '\n' : ',';
  const raw = input.split(separator).map(s => s.trim()).filter(Boolean);

  const seen = new Set<string>();
  const fields: SchemaField[] = [];

  for (const entry of raw) {
    // Support "field_name - description" format
    const dashIdx = entry.indexOf(' - ');
    const namePart = dashIdx >= 0 ? entry.slice(0, dashIdx).trim() : entry.trim();
    const description = dashIdx >= 0 ? entry.slice(dashIdx + 3).trim() : '';

    const name = toSnakeCase(namePart);
    if (!name || seen.has(name)) continue;
    seen.add(name);

    fields.push({
      name,
      type: inferType(name),
      description,
      required: true,
      tier: 'requested',
    });
  }

  return fields;
}

function toSnakeCase(input: string): string {
  return input
    .replace(/([a-z])([A-Z])/g, '$1_$2') // camelCase → camel_Case
    .replace(/[\s\-]+/g, '_') // spaces/hyphens → underscores
    .replace(/[^a-zA-Z0-9_]/g, '') // strip special chars
    .toLowerCase();
}

function inferType(name: string): FieldType {
  if (name.includes('price') || name.includes('cost') || name.includes('discount_amount')) return 'price';
  if (name.includes('image')) return 'image_url';
  if (name === 'url' || name.includes('_url') || name.includes('link') || name.includes('href')) return 'url';
  if (name.includes('rating') || name.includes('count') || name.includes('number') || name.includes('review_count')) return 'number';
  if (name.includes('in_stock') || name.includes('available') || name.startsWith('is_') || name.startsWith('has_')) return 'boolean';
  if (name.includes('date') || name.includes('time') || name.includes('publish')) return 'date';
  if (name.includes('features') || name.includes('images') || name.includes('tags')) return 'array';
  return 'string';
}
