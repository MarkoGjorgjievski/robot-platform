/**
 * Convert a human name into a URL-safe slug.
 * Lowercase, alphanumeric + hyphens, no leading/trailing hyphens.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
