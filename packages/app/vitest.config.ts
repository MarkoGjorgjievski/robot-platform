import { defineConfig } from 'vitest/config';

// Deliberately without the TanStack Start plugin: the unit tests cover the pure
// modules in src/lib (tokens, theme), which need no router, no SSR and no
// route-tree generation. Vitest prefers this file over vite.config.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
});
