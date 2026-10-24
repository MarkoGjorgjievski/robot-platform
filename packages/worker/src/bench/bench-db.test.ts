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

async function benchDatabases(): Promise<string[]> {
  const sql = postgres(databaseUrl(BASE, 'postgres'), { max: 1, onnotice: () => {} });
  try { return (await sql<{ datname: string }[]>`SELECT datname FROM pg_database WHERE datname LIKE 'robot_bench_%'`).map((r) => r.datname); } finally { await sql.end(); }
}

describe('createBenchDatabase', () => {
  it('drops the database it created when the migration fails', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'bench-no-migrations-'));
    const before = new Set(await benchDatabases());
    try {
      await expect(createBenchDatabase(BASE, { migrationsFolder: empty })).rejects.toThrow();
      expect((await benchDatabases()).filter((d) => !before.has(d))).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
