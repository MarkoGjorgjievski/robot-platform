// packages/api/vitest.config.ts
// Vitest's defaults, plus: every test starts with Jev in shadow OFF, whatever the repo .env says
// (an env value already set wins over .env in @robot/db's loader, an empty one included), so no
// test that runs a proof-page capture can send a real, paid TypeSafe request. The Jev tests turn
// it on explicitly, with a fake client. Mail is off too (SMTP_URL empty), so no test sends a real email; a test that
// sends passes its own env with the in-process sink's URL. Rate limits are off too (RATE_LIMITS=off): a suite makes
// hundreds of calls a minute on one session; isolation/rate-limit.test.ts turns them on with its own limiter.
// Logs at warn and no error reports (spec 2026-10-25 monitoring), whatever .env says.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { JEV_SHADOW: '', SMTP_URL: '', RATE_LIMITS: 'off', LOG_FORMAT: '', LOG_LEVEL: 'warn', ERROR_REPORT_URL: '', ERROR_REPORT_TOKEN: '' },
    setupFiles: ['./src/test-setup/job-queue.ts'],
  },
});
