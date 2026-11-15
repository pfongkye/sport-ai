import { expect, type Page } from '@playwright/test'

/** Fails if the page scrolls horizontally (the bug that displaced the fixed bottom nav on phones). */
export async function expectNoHorizontalOverflow(page: Page) {
  // Compare against the CONFIGURED viewport, not window.innerWidth: with isMobile emulation
  // Chromium widens the layout viewport to fit overflowing content, so innerWidth would
  // grow with the overflow and hide the bug.
  const innerWidth = page.viewportSize()!.width
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }))
  const m = { ...widths, innerWidth }
  expect(m.scrollWidth, `documentElement overflows: ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.innerWidth)
  expect(m.bodyScrollWidth, `body overflows: ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.innerWidth)
}

/** Mobile bottom nav must be inside the viewport, flush to the bottom and full width. */
export async function expectBottomNavPinned(page: Page) {
  const nav = page.getByRole('navigation', { name: 'Mobile navigation' })
  await expect(nav).toBeVisible()
  const box = (await nav.boundingBox())!
  const vp = page.viewportSize()!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5)
  expect(box.y + box.height).toBeGreaterThanOrEqual(vp.height - 1)
}
