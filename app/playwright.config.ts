import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright e2e/screenshot tests. See "End-to-end tests" in AGENTS.md.
 *
 * The app runs with `next dev` pointed at a stub Supabase server
 * (e2e/support/stub-supabase.mjs), so no database, auth provider or API key is needed.
 * `next dev` (not `next build`) is used because next/font/google can fall back
 * offline in dev, while the production build hard-fails without Google Fonts.
 *
 * PW_CHROMIUM_PATH: use an already-installed Chromium instead of the downloaded one.
 */
const APP_PORT = Number(process.env.E2E_APP_PORT || 3100)
const STUB_PORT = Number(process.env.STUB_SUPABASE_PORT || 54321)
const baseURL = `http://localhost:${APP_PORT}`

const launchOptions = process.env.PW_CHROMIUM_PATH
  ? { executablePath: process.env.PW_CHROMIUM_PATH, args: ['--no-sandbox'] }
  : {}
const chromium = { ...devices['Desktop Chrome'], launchOptions }
// Chromium-based phone profiles (avoid needing WebKit); same viewport/touch/DPR as the devices.
const phone = (width: number, height: number) => ({
  ...chromium,
  viewport: { width, height },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
})

export default defineConfig({
  testDir: './e2e',
  outputDir: 'e2e-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]] : 'list',
  timeout: 60_000,
  use: { baseURL, colorScheme: 'dark', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile-360x800', use: phone(360, 800) },
    { name: 'mobile-390x844', use: phone(390, 844) },
    { name: 'desktop-1280x800', use: { ...chromium, viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    {
      command: 'node e2e/support/stub-supabase.mjs',
      url: `http://localhost:${STUB_PORT}/__health`,
      reuseExistingServer: !process.env.CI,
      env: { STUB_SUPABASE_PORT: String(STUB_PORT) },
    },
    {
      command: `npx next dev -p ${APP_PORT}`,
      url: `${baseURL}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${STUB_PORT}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-anon-key',
        SUPABASE_INTERNAL_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: 'e2e-service-key',
        NEXT_PUBLIC_APP_URL: baseURL,
        ALLOWED_EMAILS: '',
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  ],
})
