import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      'node_modules',
      'dist',
      'reference-repos/**',
    ],
    // Coverage ratchet (P0-0 baseline 2026-10-10, see docs/metrics/baseline.md):
    // fail if coverage drops below the measured values. Raise, never lower.
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 22.64,
        functions: 41.7,
        branches: 71.31,
        statements: 22.64,
      },
    },
  },
  resolve: {
    alias: {
      '@/': './src/',
    },
  },
  esbuild: {
    target: 'esnext',
  },
});
