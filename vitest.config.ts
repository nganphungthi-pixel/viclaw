import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      'node_modules',
      'dist',
      'reference-repos/**',
    ],
    // Coverage ratchet (P0-0 baseline 2026-10-10, see docs/metrics/baseline.md).
    // V8 coverage wobbles per OS/Node (observed 21.8-22.64 lines,
    // 71.06-71.31 branches across the matrix), so the ratchet sits at the
    // observed FLOOR, not the local max — a same-machine exact value fails
    // everywhere else. Floors stay within 1 point of the local max (review
    // rule), or the ratchet is meaningless. Raise on genuine gains, never lower.
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 21.7,
        functions: 41.7,
        branches: 71.0,
        statements: 21.7,
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
