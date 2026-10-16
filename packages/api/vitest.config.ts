// packages/api/vitest.config.ts
// Vitest's defaults, plus: every test starts with Jev in shadow OFF, whatever the repo .env says
// (an env value already set wins over .env in @robot/db's loader, an empty one included), so no
// test that runs a proof-page capture can send a real, paid TypeSafe request. The Jev tests turn
// it on explicitly, with a fake client.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { JEV_SHADOW: '' },
  },
});
