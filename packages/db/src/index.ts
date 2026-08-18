import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Load the repo-root .env so every consumer (tests, CLIs, api-server) resolves
// DATABASE_URL without needing it exported in the shell. Already-set env vars win.
try {
  loadEnvFile(join(fileURLToPath(new URL('../../..', import.meta.url)), '.env'));
} catch {
  // .env not present — fall back to whatever is already in process.env
}

const connectionString = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/robot_platform';

const client = postgres(connectionString);
export const db = drizzle(client, { schema });

export * from './schema';
export type Database = typeof db;
