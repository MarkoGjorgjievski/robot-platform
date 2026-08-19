/** Where a schema field's value is resolved. Absent means the detail page. */
export const FIELD_ORIGINS = ['detail', 'listing', 'input', 'system'] as const;

export type FieldOrigin = (typeof FIELD_ORIGINS)[number];

const LABELS: Record<FieldOrigin, string> = {
  detail: 'Detail page',
  listing: 'Listing page',
  input: 'Input column',
  system: 'System',
};

export function originLabel(origin?: string): string {
  return LABELS[(origin ?? 'detail') as FieldOrigin] ?? LABELS.detail;
}
