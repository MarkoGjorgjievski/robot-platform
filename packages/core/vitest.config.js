import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.js', '.mjs', '.mts', '.json'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{js,ts}', 'src/**/__tests__/**/*.{js,ts}'],
    setupFiles: ['./vitest.setup.js'],
  },
});
