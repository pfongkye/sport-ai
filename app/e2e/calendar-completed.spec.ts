import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { signIn } from './support/auth'
import { mockBrowserApis } from './support/mock-api'
import { expectNoHorizontalOverflow } from './support/layout'

const STUB = `http://localhost:${process.env.STUB_SUPABASE_PORT || 54321}`
const style = 'nextjs-portal { display: none !important }'
const A = (n: number) => `00000000-0000-4000-8000-0000000004${n}`
const token = (testInfo: TestInfo) => `e2e-plan-${testInfo.project.name}`

test.beforeEach(async ({ context, page, baseURL }, testInfo) => {
  await signIn(context, baseURL!, token(testInfo))
  await mockBrowserApis(page)
})

async function shot(page: Page, testInfo: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: `e2e-screenshots/${testInfo.project.name}/${name}.png`, fullPage: true, style })
}

test('completed activities render before the planned session and link to the activity', async ({ page }, testInfo) => {
  await page.goto('/plan')
  // The week with the fixtures may not be the one shown if the plan starts later; fixtures are in the current week.
  const run = page.getByTestId('activity-card').filter({ has: page.locator(`a[href="/activities/${A(10)}"]`) })
  await expect(run).toHaveCount(1)
  await expect(run.getByText('Completed', { exact: true })).toBeVisible()
  await expect(run).toContainText('km')
  await expect(run.getByRole('link', { name: 'View activity' })).toHaveAttribute('href', `/activities/${A(10)}`)

  // Same day: the completed card comes before the planned tempo session.
  const day = page.getByRole('listitem').filter({ has: run })
  const order = await day.evaluate((el) => {
    const nodes = [...el.querySelectorAll('[data-testid="activity-card"], article')]
    return nodes.map((n) => (n.tagName === 'ARTICLE' ? 'session' : 'activity'))
  })
  expect(order).toEqual(['activity', 'session'])

  // Unlinked ride on a rest day (no planned session).
  const ride = page.getByTestId('activity-card').filter({ has: page.locator(`a[href="/activities/${A(11)}"]`) })
  await expect(ride).toHaveCount(1)
  await expect(ride).toContainText('42.00 km')

  // The activity linked to the completed session is not duplicated as a card.
  const linkedId = '00000000-0000-4000-8000-000000000101'
  await expect(page.locator(`[data-testid="activity-card"] a[href="/activities/${linkedId}"]`)).toHaveCount(0)
  await expect(page.getByRole('article', { name: /Done/ })).toHaveCount(1)

  await day.scrollIntoViewIfNeeded()
  await shot(page, testInfo, 'plan-completed-activities')
})

test('day Sync (not connected to Strava) announces and shows the newly available activity', async ({ page }, testInfo) => {
  await page.goto('/plan')
  await expect(page.locator(`a[href="/activities/${A(12)}"]`)).toHaveCount(0)
  // Strava is called server-side and cannot be mocked from the browser: the real route runs its
  // not-connected path (stub strava_connections is empty); the stub then reveals the activity.
  await fetch(`${STUB}/__e2e/reveal-activities?token=${token(testInfo)}`, { method: 'POST' })

  const today = page.getByRole('listitem').filter({ has: page.getByText('Today', { exact: true }) })
  const post = page.waitForResponse((r) => /\/api\/plan\/days\/[\d-]+\/sync$/.test(r.url()) && r.request().method() === 'POST')
  await today.getByRole('button', { name: /^Sync/ }).click()
  expect((await post).status()).toBe(200)
  await expect(page.getByRole('status').filter({ hasText: /showing saved activities/ })).toHaveCount(1)
  await expect(page.locator(`a[href="/activities/${A(12)}"]`)).toHaveCount(1)
  await today.scrollIntoViewIfNeeded()
  await shot(page, testInfo, 'plan-after-sync')
})

test('deleting a planned session leaves the completed card on that day', async ({ page }) => {
  await page.goto('/plan')
  const run = page.getByTestId('activity-card').filter({ has: page.locator(`a[href="/activities/${A(10)}"]`) })
  const day = page.getByRole('listitem').filter({ has: run })
  const session = day.getByRole('article')
  await session.getByRole('button', { name: /^Delete/ }).click()
  await session.getByRole('button', { name: 'Delete session' }).click()
  await expect(day.getByRole('article')).toHaveCount(0)
  await expect(run).toHaveCount(1)
})
