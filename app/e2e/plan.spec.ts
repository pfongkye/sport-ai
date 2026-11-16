import { test, expect } from '@playwright/test'
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

  await page.getByRole('checkbox', { name: 'wednesday' }).check({ force: true })
  await page.getByRole('checkbox', { name: 'tuesday' }).uncheck({ force: true })
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
    },
  })
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
