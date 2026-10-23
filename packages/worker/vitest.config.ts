// packages/worker/vitest.config.ts — as @robot/api's: Jev in shadow off whatever .env says, and every
// test file on its own job queue (src/test-setup/job-queue.ts). Real processes and a real Chromium: long timeouts.
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { env: { JEV_SHADOW: '' }, setupFiles: ['./src/test-setup/job-queue.ts'], testTimeout: 120_000, hookTimeout: 60_000 } });
