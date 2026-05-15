import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Procedures use CAPTURES_DIR to know where to write screenshots
process.env.CAPTURES_DIR ??= join(__dirname, '..', 'public', 'captures');

const app = createApp();
const port = Number(process.env.PORT ?? 4000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[api-server] listening on http://localhost:${info.port}`);
});
