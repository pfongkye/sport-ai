import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Vitest config for characterization/unit tests.
 *
 * These tests pin the CURRENT behaviour of the deterministic AI-adjacent code
 * (splits math, Strava mapping, dedup, error mapping, allow-list, tool wiring)
 * so the AI SDK v5 / Mastra 1.x upgrade can be verified against today's output.
 * They do NOT call OpenAI or hit a database — the live-model path is covered by
 * the manual checklist in task-ai-sdk-v5-mastra-upgrade.md.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
})
