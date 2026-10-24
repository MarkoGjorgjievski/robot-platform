// packages/worker/vitest.config.ts — as @robot/api's: Jev in shadow off and mail off (SMTP_URL empty, so no test sends a real email) whatever .env says, rate limits off, and every
// test file on its own job queue (src/test-setup/job-queue.ts). Real processes and a real Chromium: long timeouts.
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { env: { JEV_SHADOW: '', SMTP_URL: '', RATE_LIMITS: 'off' }, setupFiles: ['./src/test-setup/job-queue.ts'], testTimeout: 120_000, hookTimeout: 60_000 } });
