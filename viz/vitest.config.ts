import { defineConfig } from 'vitest/config';

// Standalone config (intentionally does NOT extend vite.config.ts) so the unit
// tests run in a clean Node environment without the app's build modes/plugins.
// Targets the pure, stateless helper modules — no DOM or MapLibre needed.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
