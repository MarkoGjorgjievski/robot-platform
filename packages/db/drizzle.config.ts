import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { defineConfig } from 'drizzle-kit';

// Load repo-root .env so DATABASE_URL resolves no matter where the CLI is invoked from.
try {
  loadEnvFile(join(fileURLToPath(new URL('../..', import.meta.url)), '.env'));
} catch {
  // .env not present — fall back to whatever is already in process.env
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/robot_platform',
  },
});
