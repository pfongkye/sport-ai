import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { signIn } from './support/auth'
import { mockBrowserApis } from './support/mock-api'
import { expectNoHorizontalOverflow } from './support/layout'

// One stub state per project: the stub remembers deletes per access token, so projects running in
// parallel do not see each other's deleted sessions.
test.beforeEach(async ({ context, page, baseURL }, testInfo) => {
  await signIn(context, baseURL!, `e2e-plan-${testInfo.project.name}`)
  await mockBrowserApis(page)
})

const style = 'nextjs-portal { display: none !important }'

test('regenerate form: constraints are pre-filled, editable and sent with the request', async ({ page }, testInfo) => {
  let body: Record<string, unknown> | null = null
  await page.route('**/api/plan/generate', async (route) => {
    body = route.request().postDataJSON()
    await route.fulfill({ status: 201, json: { planId: 'p', sessionCount: 20, weeks: 9, adjustments: [] } })
  })
  page.on('dialog', (d) => void d.accept()) // "This replaces your current plan" confirm

  await page.goto('/plan')
  await page.getByRole('button', { name: 'Regenerate plan' }).click()

  // Pre-filled from the stored plan constraints (Tuesday, Thursday + notes).
  await expect(page.getByRole('checkbox', { name: 'tuesday' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'thursday' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'wednesday' })).not.toBeChecked()
  const notes = page.getByLabel('Other constraints (optional)')
  await expect(notes).toHaveValue('1 leisure session per week')

  // Click the visible day chip (the checkbox itself is sr-only and can sit under the mobile nav).
  await page.locator('label', { has: page.getByRole('checkbox', { name: 'wednesday' }) }).click()
  await page.locator('label', { has: page.getByRole('checkbox', { name: 'tuesday' }) }).click()
  await expect(page.getByRole('checkbox', { name: 'wednesday' })).toBeChecked()
  await notes.fill('1 leisure session per week, no hard runs in May')

  await expectNoHorizontalOverflow(page)
  const shot = `e2e-screenshots/${testInfo.project.name}`
  await notes.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${shot}/plan-constraints-form.png`, style })
  await page.screenshot({ path: `${shot}/plan-constraints-form-full.png`, fullPage: true, style })

  await page.getByRole('button', { name: /^Regenerate plan$/ }).last().click()
  await expect.poll(() => body).not.toBeNull()
  expect(body).toMatchObject({
    constraints: {
      unavailableWeekdays: ['wednesday', 'thursday'],
      notes: '1 leisure session per week, no hard runs in May',
      // Pre-filled from the stored plan: 10 km in 40:00, peak weekly override 40.
      race: { distance: '10k', targetTimeS: 2400 },
      limits: { maxWeeklyKm: 40 },
    },
  })
})

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  const shot = `e2e-screenshots/${testInfo.project.name}`
  await page.screenshot({ path: `${shot}/${name}.png`, fullPage: true, style })
}

function captureBody(page: Page) {
  const out: { body: Record<string, unknown> | null } = { body: null }
  void page.route('**/api/plan/generate', async (route) => {
    out.body = route.request().postDataJSON()
    await route.fulfill({ status: 201, json: { planId: 'p', sessionCount: 20, weeks: 9, adjustments: [] } })
  })
  page.on('dialog', (d) => void d.accept())
  return out
}

/** A Sunday well in the future, as YYYY-MM-DD. */
function futureSunday(): string {
  const d = new Date(Date.now() + 70 * 86400000)
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7))
  return d.toISOString().slice(0, 10)
}

test('regenerate form pre-fills race, target time, date and limits from the stored plan', async ({ page }, testInfo) => {
  await page.goto('/plan')
  await page.getByRole('button', { name: 'Regenerate plan' }).click()
  await expect(page.getByLabel('Race distance')).toHaveValue('10k')
  await expect(page.getByLabel('Race date')).not.toHaveValue('')
  await expect(page.getByLabel('Target time minutes')).toHaveValue('40')
  const adjust = page.getByRole('button', { name: /Adjust limits/ })
  await expect(adjust).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByLabel('Peak weekly km')).toHaveValue('40')
  await expect(page.getByLabel('Longest run km')).toHaveValue('')
  await expect(page.getByLabel('Longest run km')).toHaveAttribute('placeholder', '18')
  await capture(page, testInfo, 'plan-regenerate-prefilled-race')
})

test('first-plan form: choosing 10 km shows suggestions and posts race and a Sunday date', async ({ page, baseURL }, testInfo) => {
  const sent = captureBody(page)
  // A token without the e2e-plan- prefix gets no active plan from the stub.
  await signIn(page.context(), baseURL!, `e2e-first-${testInfo.project.name}`)
  await page.goto('/plan')
  await expect(page.getByLabel('Race distance')).toBeVisible()
  await expect(page.getByLabel('Goal date (optional)')).toBeVisible()
  await expect(page.getByLabel('Target time minutes')).toHaveCount(0)

  await page.getByLabel('Race distance').selectOption('10k')
  await expect(page.getByLabel('Race date')).toBeVisible()
  const sunday = futureSunday()
  await page.getByLabel('Race date').fill(sunday)
  await page.getByLabel('Target time minutes').fill('40')
  await page.getByRole('button', { name: /Adjust limits/ }).click()
  await expect(page.getByText('Suggested for 10 km: 55 km/week, 18 km long run, 8 day taper')).toBeVisible()
  await expect(page.getByLabel('Peak weekly km')).toHaveAttribute('placeholder', '55')
  await capture(page, testInfo, 'plan-first-form-10k-limits')

  await page.getByRole('button', { name: /^Generate plan$/ }).click()
  await expect.poll(() => sent.body).not.toBeNull()
  expect(sent.body).toMatchObject({
    goalDate: sunday,
    constraints: { race: { distance: '10k', targetTimeS: 2400 }, limits: null },
  })
})

test('limits: editing sends the override, Reset to suggested clears it', async ({ page }, testInfo) => {
  const sent = captureBody(page)
  await page.goto('/plan')
  await page.getByRole('button', { name: 'Regenerate plan' }).click()
  await page.getByLabel('Longest run km').fill('15')
  await expect(page.getByRole('button', { name: 'Reset to suggested' })).toBeEnabled()
  await page.getByRole('button', { name: /^Regenerate plan$/ }).last().click()
  await expect.poll(() => sent.body).not.toBeNull()
  expect(sent.body).toMatchObject({ constraints: { limits: { maxWeeklyKm: 40, maxLongRunKm: 15 } } })

  sent.body = null
  await page.getByRole('button', { name: 'Regenerate plan' }).first().click()
  await page.getByRole('button', { name: 'Reset to suggested' }).click()
  await expect(page.getByLabel('Peak weekly km')).toHaveValue('')
  await capture(page, testInfo, 'plan-limits-reset')
  await page.getByRole('button', { name: /^Regenerate plan$/ }).last().click()
  await expect.poll(() => sent.body).not.toBeNull()
  expect((sent.body as unknown as { constraints: { limits: unknown } }).constraints.limits).toBeNull()
})

test('other distance asks for km and sends it', async ({ page }, testInfo) => {
  const sent = captureBody(page)
  await page.goto('/plan')
  await page.getByRole('button', { name: 'Regenerate plan' }).click()
  await page.getByLabel('Race distance').selectOption('other')
  await page.getByLabel('Distance in km').fill('15')
  await expect(page.getByLabel('Race distance')).toHaveValue('other')
  await capture(page, testInfo, 'plan-other-distance')
  await page.getByRole('button', { name: /^Regenerate plan$/ }).last().click()
  await expect.poll(() => sent.body).not.toBeNull()
  expect(sent.body).toMatchObject({ constraints: { race: { distance: 'other', distanceKm: 15 } } })
})

test('delete a session: confirmation step, Keep cancels, Delete removes it from the calendar', async ({ page }, testInfo) => {
  await page.goto('/plan')
  const longRun = page.getByRole('article', { name: /long run/i })
  await expect(longRun).toHaveCount(1)

  // Completed sessions have no Delete control.
  const completed = page.getByRole('article', { name: /Done/ })
  await expect(completed).toHaveCount(1)
  await expect(completed.getByRole('button', { name: /^Delete/ })).toHaveCount(0)

  const shot = `e2e-screenshots/${testInfo.project.name}`
  await page.screenshot({ path: `${shot}/plan-calendar-delete-button.png`, style })

  // First click only asks for confirmation; "Keep" backs out without deleting.
  await longRun.getByRole('button', { name: /^Delete/ }).click()
  const dialog = longRun.getByRole('alertdialog')
  await expect(dialog).toContainText('Delete this session from your plan?')
  await longRun.scrollIntoViewIfNeeded()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: `${shot}/plan-delete-confirm.png`, style })
  await dialog.getByRole('button', { name: 'Keep' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(longRun).toHaveCount(1)

  // Confirm: the session disappears after the server refresh and the rest stay.
  await longRun.getByRole('button', { name: /^Delete/ }).click()
  await longRun.getByRole('button', { name: 'Delete session' }).click()
  await expect(page.getByRole('article', { name: /long run/i })).toHaveCount(0)
  await expect(page.getByRole('article', { name: /Done/ })).toHaveCount(1)
  await expect(page.getByRole('status').filter({ hasText: /deleted\./ })).toHaveCount(1)
  await page.screenshot({ path: `${shot}/plan-after-delete.png`, style })

  // Still gone after a reload (the stub applied the DELETE).
  await page.reload()
  await expect(page.getByRole('article', { name: /long run/i })).toHaveCount(0)
})

test('delete API: unknown ids are 404 and completed sessions are refused with 409', async ({ page, request }) => {
  await page.goto('/plan') // establishes cookies on the page's context
  const ctx = page.context().request
  const unknown = await ctx.delete('/api/plan/sessions/00000000-0000-4000-8000-0000000003ff')
  expect(unknown.status()).toBe(404)
  const completed = await ctx.delete('/api/plan/sessions/00000000-0000-4000-8000-000000000301')
  expect(completed.status()).toBe(409)
  void request
})
