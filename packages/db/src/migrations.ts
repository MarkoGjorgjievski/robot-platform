// The migrations bundled in this package (drizzle/meta/_journal.json). /readyz compares the database's applied count
// (drizzle.__drizzle_migrations) with it (spec 2026-10-25 monitoring §2.1). The Docker images carry packages/db whole.
import { readFileSync } from 'node:fs';

let cached: number | null = null;

export function migrationCount(): number {
  if (cached === null) {
    const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: unknown[] };
    cached = journal.entries.length;
  }
  return cached;
}
