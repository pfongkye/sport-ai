import { test, expect, type Page, type Route } from '@playwright/test'
import { signIn } from './support/auth'
import { mockBrowserApis } from './support/mock-api'
import { expectBottomNavPinned, expectNoHorizontalOverflow } from './support/layout'

interface MockSession {
  id: string
  title: string
  created_at: string
  updated_at: string
}
interface MockMemory {
  id: string
  title: string
  summary: string
  created_at: string
}

/** Stateful in-spec mock of the chat session, history and memory APIs. No real AI. */
async function mockChatApis(page: Page, opts: { failSummary?: boolean } = {}) {
  const sessions: MockSession[] = [
    { id: 's2', title: 'Marathon pacing questions', created_at: '2025-06-21T08:00:00Z', updated_at: '2025-06-21T08:00:00Z' },
    { id: 's1', title: 'Weekly check-in', created_at: '2025-06-20T08:00:00Z', updated_at: '2025-06-20T08:00:00Z' },
  ]
  const memories: MockMemory[] = []
  const deletes: string[] = []
  let counter = 0
  const history: Record<string, { id: string; role: string; content: string; created_at: string }[]> = {
    s1: [{ id: 'a1', role: 'user', content: 'How was my week?', created_at: '2025-06-20T08:00:00Z' }],
    s2: [{ id: 'b1', role: 'user', content: 'Pacing for 42k?', created_at: '2025-06-21T08:00:00Z' }],
  }

  await page.route('**/api/ai/chat/sessions', (r: Route) => {
    if (r.request().method() === 'POST') {
      counter++
      const s = { id: `n${counter}`, title: 'New chat', created_at: '2025-06-22T08:00:00Z', updated_at: '2025-06-22T08:00:00Z' }
      sessions.unshift(s)
      history[s.id] = []
      return r.fulfill({ status: 201, json: { session: s } })
    }
    return r.fulfill({ json: { sessions } })
  })
  await page.route('**/api/ai/chat/sessions/*', (r: Route) => {
    const url = new URL(r.request().url())
    const id = url.pathname.split('/').pop()!
    const keep = url.searchParams.get('keepHistory') === 'true'
    deletes.push(`${id}:${keep}`)
    if (keep && opts.failSummary) return r.fulfill({ status: 502, json: { error: 'Could not summarize the chat.' } })
    const i = sessions.findIndex((s) => s.id === id)
    const [removed] = sessions.splice(i, 1)
    let memory: MockMemory | null = null
    if (keep) {
      memory = { id: `m${id}`, title: removed.title, summary: `Summary of ${removed.title}: athlete targets a steady 5:30/km.`, created_at: '2025-06-22T09:00:00Z' }
      memories.unshift(memory)
    }
    return r.fulfill({ json: { deleted: id, memory } })
  })
  await page.route('**/api/ai/chat/history*', (r: Route) => {
    const id = new URL(r.request().url()).searchParams.get('sessionId') ?? sessions[0]?.id ?? null
    return r.fulfill({ json: { messages: id ? (history[id] ?? []) : [], sessionId: id } })
  })
  await page.route('**/api/ai/chat/memories', (r: Route) => r.fulfill({ json: { memories } }))
  await page.route('**/api/ai/chat/memories/*', (r: Route) => {
    const id = new URL(r.request().url()).pathname.split('/').pop()!
    const i = memories.findIndex((m) => m.id === id)
    if (r.request().method() === 'PATCH') {
      memories[i].summary = JSON.parse(r.request().postData() ?? '{}').summary
      return r.fulfill({ json: { memory: memories[i] } })
    }
    memories.splice(i, 1)
    return r.fulfill({ json: { deleted: id } })
  })
  return { deletes, sessions, memories }
}

const STYLE = 'nextjs-portal { display: none !important }'

async function shot(page: Page, project: string, name: string) {
  await page.screenshot({ path: `e2e-screenshots/${project}/chat-${name}.png`, style: STYLE })
}

async function guards(page: Page, project: string) {
  await expectNoHorizontalOverflow(page)
  if (project.startsWith('mobile')) await expectBottomNavPinned(page)
  // The composer must stay on screen even with the panel open.
  const box = (await page.getByPlaceholder('Ask your coach, or tap the mic…').boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height)
}

test.beforeEach(async ({ context, page, baseURL }) => {
  await signIn(context, baseURL!)
  await mockBrowserApis(page)
})

async function open(page: Page) {
  await page.goto('/coach')
  await expect(page.getByText('Pacing for 42k?')).toBeVisible()
}

test('new chat, switch, and layout with the panel open', async ({ page }, testInfo) => {
  const project = testInfo.project.name
  await mockChatApis(page)
  await open(page)
  await guards(page, project)
  await shot(page, project, 'closed')

  const toggle = page.getByRole('button', { name: 'Chats', exact: true })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await guards(page, project)
  await shot(page, project, 'panel')

  await page.getByRole('button', { name: /Weekly check-in/ }).first().click()
  await expect(page.getByText('How was my week?')).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  const newChat = page.getByRole('button', { name: 'New chat' })
  await expect(newChat).toBeEnabled()
  await newChat.click()
  await expect(page.getByText('Ask your AI coach')).toBeVisible()
  await expect(newChat).toBeDisabled()
})

test('delete with kept summary shows the note in Kept notes', async ({ page }, testInfo) => {
  const project = testInfo.project.name
  const mock = await mockChatApis(page)
  await open(page)
  await page.getByRole('button', { name: 'Chats', exact: true }).click()
  await page.getByRole('button', { name: 'Delete chat Marathon pacing questions' }).click()

  const dialog = page.getByRole('alertdialog', { name: /Confirm deleting chat Marathon/ })
  await expect(dialog).toContainText('Keep a short summary so the coach remembers the key points?')
  for (const name of ['Delete and keep summary', 'Delete everything', 'Cancel']) {
    const box = (await dialog.getByRole('button', { name }).boundingBox())!
    expect(box.height, `${name} touch target`).toBeGreaterThanOrEqual(43.5)
  }
  const del = (await page.getByRole('button', { name: 'Delete chat Weekly check-in' }).boundingBox())!
  expect(del.width).toBeGreaterThanOrEqual(43.5)
  expect(del.height).toBeGreaterThanOrEqual(43.5)
  await guards(page, project)
  await shot(page, project, 'confirm')

  await dialog.getByRole('button', { name: 'Delete and keep summary' }).click()
  await expect(page.getByRole('status')).toContainText('A summary was added to Kept notes')
  expect(mock.deletes).toEqual(['s2:true'])
  await expect(page.getByText('Summary of Marathon pacing questions', { exact: false })).toBeVisible()
  // Active chat was deleted: switched to the remaining one.
  await expect(page.getByText('How was my week?')).toBeVisible()
  await guards(page, project)
  await shot(page, project, 'kept-notes')

  // Edit and delete the note.
  await page.getByRole('button', { name: /Edit note/ }).first().click()
  await page.getByRole('textbox', { name: /Edit note/ }).fill('Edited note text')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Edited note text')).toBeVisible()
  await page.getByRole('button', { name: /Delete note/ }).first().click()
  await page.getByRole('button', { name: 'Delete note', exact: true }).click()
  await expect(page.getByText('No kept notes yet.')).toBeVisible()
})

test('delete everything and cancel', async ({ page }) => {
  const mock = await mockChatApis(page)
  await open(page)
  await page.getByRole('button', { name: 'Chats', exact: true }).click()

  await page.getByRole('button', { name: 'Delete chat Weekly check-in' }).click()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('alertdialog')).toBeHidden()
  expect(mock.deletes).toEqual([])

  await page.getByRole('button', { name: 'Delete chat Weekly check-in' }).click()
  await page.getByRole('button', { name: 'Delete everything' }).click()
  await expect(page.getByRole('status')).toContainText('Chat deleted.')
  expect(mock.deletes).toEqual(['s1:false'])
  await expect(page.getByText('No kept notes yet.')).toBeVisible()
})

test('summary failure keeps the chat and still offers delete everything', async ({ page }, testInfo) => {
  const project = testInfo.project.name
  const mock = await mockChatApis(page, { failSummary: true })
  await open(page)
  await page.getByRole('button', { name: 'Chats', exact: true }).click()
  await page.getByRole('button', { name: 'Delete chat Marathon pacing questions' }).click()
  await page.getByRole('button', { name: 'Delete and keep summary' }).click()

  await expect(page.getByRole('alertdialog').getByRole('alert')).toContainText('The chat was not deleted')
  expect(mock.sessions).toHaveLength(2)
  await guards(page, project)
  await shot(page, project, 'summary-error')

  await page.getByRole('button', { name: 'Delete everything' }).click()
  await expect(page.getByRole('status')).toContainText('Chat deleted.')
  expect(mock.deletes).toEqual(['s2:true', 's2:false'])
})
