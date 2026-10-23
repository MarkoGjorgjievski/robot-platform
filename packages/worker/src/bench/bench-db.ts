// The benchmark's own database (spec 2026-10-23 run speed §5.2): created on the same Postgres server, migrated,
// dropped afterwards — so not one row lands in Marko's database. A `robot_bench_*` older than six hours (a bench
// that was killed) is dropped at the next start.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const here = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS = join(here, '..', '..', '..', 'db', 'drizzle');

export function databaseUrl(base: string, name: string): string {
  const u = new URL(base);
  u.pathname = `/${name}`;
  return u.toString();
}

async function admin<T>(base: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(databaseUrl(base, 'postgres'), { max: 1, onnotice: () => {} });
  try { return await fn(sql); } finally { await sql.end(); }
}

export async function createBenchDatabase(base: string): Promise<{ name: string; url: string; drop(): Promise<void> }> {
  const stamp = Date.now();
  const name = `robot_bench_${stamp}`;
  await admin(base, async (sql) => {
    const old = await sql<{ datname: string }[]>`SELECT datname FROM pg_database WHERE datname LIKE 'robot_bench_%'`;
    for (const { datname } of old) {
      const at = Number(datname.slice('robot_bench_'.length));
      if (Number.isFinite(at) && stamp - at > 6 * 3_600_000) await sql.unsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
    await sql.unsafe(`CREATE DATABASE "${name}"`);
  });
  const url = databaseUrl(base, name);
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try { await migrate(drizzle(client), { migrationsFolder: MIGRATIONS }); } finally { await client.end(); }
  return { name, url, drop: () => admin(base, async (sql) => { await sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); }) };
}
