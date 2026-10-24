// The bench's throwaway database (final review M4): a migration that fails drops the database it was migrating,
// so a broken bench leaves no `robot_bench_*` behind. Creates and drops only its own database on the dev server.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createBenchDatabase, databaseUrl } from './bench-db.js';
import '@robot/db';

const BASE = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/robot_platform';

// Only this test's own database is checked and dropped: a bench running at the same time keeps its own.
async function onAdmin<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(databaseUrl(BASE, 'postgres'), { max: 1, onnotice: () => {} });
  try { return await fn(sql); } finally { await sql.end(); }
}
const exists = (name: string) => onAdmin(async (sql) => (await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`).length > 0);

describe('createBenchDatabase', () => {
  it('drops the database it created when the migration fails', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'bench-no-migrations-'));
    // Not a number after the prefix, so another bench's six-hour sweep never touches it.
    const name = `robot_bench_test_${process.pid}_${Date.now()}`;
    try {
      await expect(createBenchDatabase(BASE, { migrationsFolder: empty, name })).rejects.toThrow();
      expect(await exists(name)).toBe(false);
    } finally {
      rmSync(empty, { recursive: true, force: true });
      await onAdmin(async (sql) => { await sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); });
    }
  });
});
