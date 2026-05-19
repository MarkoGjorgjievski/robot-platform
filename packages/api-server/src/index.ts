import { serve } from '@hono/node-server';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Load repo-root .env (ANTHROPIC_API_KEY etc.) before importing app.
// Path resolves the same in dev (tsx, runs from src/) and in build (node, runs from dist/).
try {
  loadEnvFile(join(__dirname, '..', '..', '..', '.env'));
} catch {
  // .env not present — fine; the app falls back to whatever's already in process.env
}

const { createApp } = await import('./app.js');

// Procedures use CAPTURES_DIR to know where to write screenshots
process.env.CAPTURES_DIR ??= join(__dirname, '..', 'public', 'captures');

const app = createApp();
const port = Number(process.env.PORT ?? 4000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[api-server] listening on http://localhost:${info.port}`);
});
