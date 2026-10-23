// packages/api-server/vitest.config.ts — as @robot/api's: Jev in shadow off whatever .env says, and every
// test file on its own job queue (src/test-setup/job-queue.ts), so no worker of Marko's runs a test's job.
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { env: { JEV_SHADOW: '' }, setupFiles: ['./src/test-setup/job-queue.ts'] } });
