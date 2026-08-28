import type { SchemaField, FieldType } from '@robot/agent';

/**
 * Normalize freeform user field input into structured SchemaField[].
 * Accepts comma-separated or newline-separated field names.
 * Supports "field_name - description" and "field_name: hint" formats —
 * whichever delimiter (' - ' or ':') occurs FIRST in the entry wins; a line
 * with only one of the two splits on that one, and a bare entry with neither
 * is unchanged.
 */
export function normalizeUserFields(input: string): SchemaField[] {
  if (!input.trim()) return [];

  // Split on commas or newlines
  const separator = input.includes('\n') ? '\n' : ',';
  const raw = input.split(separator).map(s => s.trim()).filter(Boolean);

  const seen = new Set<string>();
  const fields: SchemaField[] = [];

  for (const entry of raw) {
    // Support "field_name: hint" (repair-engine requested-field format, split
    // on the FIRST colon only — a hint may itself contain colons) and
    // "field_name - description" formats. Whichever delimiter occurs FIRST in
    // the entry wins — a dash before any colon (e.g. "price - in USD: ...")
    // must split on the dash, not the colon, or the name swallows everything
    // up to the colon and half the description is lost. A bare entry with
    // neither delimiter is unchanged.
    const colonIdx = entry.indexOf(':');
    const dashIdx = entry.indexOf(' - ');
    const useColon = colonIdx >= 0 && (dashIdx === -1 || colonIdx < dashIdx);
    const useDash = dashIdx >= 0 && (colonIdx === -1 || dashIdx < colonIdx);

    let namePart: string;
    let description: string;
    if (useColon) {
      namePart = entry.slice(0, colonIdx).trim();
      description = entry.slice(colonIdx + 1).trim();
    } else if (useDash) {
      namePart = entry.slice(0, dashIdx).trim();
      description = entry.slice(dashIdx + 3).trim();
    } else {
      namePart = entry.trim();
      description = '';
    }

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
