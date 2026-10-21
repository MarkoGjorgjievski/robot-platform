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

// The scheduled website check (spec 2026-10-21 §3.3): every hour, free (proof pages + listing sample, no AI).
// Off unless `WEBSITE_CHECKS=on` — a dev api-server never loads pages on its own.
const { startWebsiteChecks, websiteChecksEnabled } = await import('@robot/api/website-checks');
startWebsiteChecks();
console.log(`[api-server] website checks ${websiteChecksEnabled() ? 'on (hourly)' : 'off (set WEBSITE_CHECKS=on to run them)'}`);
