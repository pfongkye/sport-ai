import { test, expect } from '@playwright/test'
import { signIn } from './support/auth'
import { mockBrowserApis } from './support/mock-api'
import { expectBottomNavPinned, expectNoHorizontalOverflow } from './support/layout'

const PAGES = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'activities', path: '/activities' },
  { name: 'routes', path: '/routes' },
  { name: 'plan', path: '/plan' },
  { name: 'nutrition', path: '/nutrition' },
  { name: 'settings', path: '/settings' },
  { name: 'coach', path: '/coach' },
]

test.beforeEach(async ({ context, page, baseURL }) => {
  await signIn(context, baseURL!)
  await mockBrowserApis(page)
})

for (const { name, path } of PAGES) {
  test(`${name}: layout + screenshot`, async ({ page }, testInfo) => {
    await page.goto(path)
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await page.waitForLoadState('networkidle')

    await expectNoHorizontalOverflow(page)
    if (testInfo.project.name.startsWith('mobile')) {
      await expectBottomNavPinned(page)
    } else {
      await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeHidden()
    }

    // Screenshots always land in e2e-screenshots/ (gitignored); CI uploads them as an artifact.
    // Viewport shot shows the fixed nav where a user sees it; full-page shot shows all content
    // (Chromium paints fixed elements at the viewport bottom, i.e. mid-image, in full-page mode).
    // The Next.js dev indicator is hidden so it does not cover the nav.
    const style = 'nextjs-portal { display: none !important }'
    const dir = `e2e-screenshots/${testInfo.project.name}`
    await page.screenshot({ path: `${dir}/${name}.png`, style })
    await page.screenshot({ path: `${dir}/${name}-full.png`, fullPage: true, style })
  })
}

test('login page renders for signed-out users', async ({ browser, baseURL }, testInfo) => {
  const ctx = await browser.newContext({ ...testInfo.project.use, baseURL })
  const page = await ctx.newPage()
  await page.goto('/login')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: `e2e-screenshots/${testInfo.project.name}/login.png`, fullPage: true })
  await ctx.close()
})
