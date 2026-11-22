import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeFakeSupabase } from '@/lib/plan/__fixtures__/fake-supabase'

let current: ReturnType<typeof makeFakeSupabase> | null = null
let authUser: { id: string } | null = null
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    ...(current!.client as object),
    auth: { getUser: async () => ({ data: { user: authUser } }) },
  }),
}))
const summarizeChat = vi.fn()
vi.mock('@/lib/ai/chat-sessions/summarize', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/chat-sessions/summarize')>()),
  summarizeChat: (...a: unknown[]) => summarizeChat(...a),
}))

import { GET as listSessions, POST as createSession } from './sessions/route'
import { DELETE as deleteSession, PATCH as patchSession } from './sessions/[id]/route'
import { GET as listMemories } from './memories/route'
import { PATCH as patchMemory, DELETE as deleteMemory } from './memories/[id]/route'
import { GET as history } from './history/route'

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const req = (method: string, url = 'http://x/api', body?: unknown) =>
  new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) })

beforeEach(() => {
  summarizeChat.mockReset()
  authUser = { id: 'u1' }
  current = makeFakeSupabase({
    rlsUserId: 'u1',
    tables: {
      coach_sessions: [
        { id: 's1', user_id: 'u1', title: 'Old', updated_at: '2026-01-01T00:00:00Z' },
        { id: 's2', user_id: 'u1', title: 'Newer', updated_at: '2026-02-01T00:00:00Z' },
        { id: 's9', user_id: 'u2', title: 'Foreign', updated_at: '2026-03-01T00:00:00Z' },
      ],
      coaching_messages: [
        { id: 'm1', user_id: 'u1', session_id: 's1', role: 'user', content: 'a', metadata: { kind: 'chat' }, created_at: '2026-01-01T00:00:00Z' },
        { id: 'm2', user_id: 'u1', session_id: 's2', role: 'user', content: 'b', metadata: { kind: 'chat' }, created_at: '2026-02-01T00:00:00Z' },
        { id: 'm3', user_id: 'u1', session_id: 's2', role: 'user', content: 'insight', metadata: { kind: 'post_session_insight' }, created_at: '2026-02-01T00:00:01Z' },
      ],
      coach_memories: [
        { id: 'k1', user_id: 'u1', title: 'T', summary: 'S', created_at: '2026-01-05T00:00:00Z' },
        { id: 'k9', user_id: 'u2', title: 'F', summary: 'F', created_at: '2026-01-05T00:00:00Z' },
      ],
    },
  })
})

describe('sessions list/create', () => {
  it('401 signed out', async () => {
    authUser = null
    expect((await listSessions()).status).toBe(401)
    expect((await createSession()).status).toBe(401)
  })
  it('lists own sessions newest first', async () => {
    const res = await listSessions()
    expect(res.status).toBe(200)
    expect((await res.json()).sessions.map((s: { id: string }) => s.id)).toEqual(['s2', 's1'])
  })
  it('creates a New chat session', async () => {
    const res = await createSession()
    expect(res.status).toBe(201)
    const { session } = await res.json()
    expect(session.title).toBe('New chat')
    expect(current!.tables.coach_sessions.find((s) => s.id === session.id)?.user_id).toBe('u1')
  })
})

describe('PATCH sessions/[id]', () => {
  it('401 signed out', async () => {
    authUser = null
    expect((await patchSession(req('PATCH', 'http://x/api', { recallOtherChats: true }), ctx('s1'))).status).toBe(401)
  })
  it('400 for a missing or non-boolean value', async () => {
    expect((await patchSession(req('PATCH', 'http://x/api', {}), ctx('s1'))).status).toBe(400)
    expect((await patchSession(req('PATCH', 'http://x/api', { recallOtherChats: 'yes' }), ctx('s1'))).status).toBe(400)
    expect((await patchSession(new Request('http://x/api', { method: 'PATCH', body: 'nope' }), ctx('s1'))).status).toBe(400)
  })
  it('404 for unknown and foreign ids, leaving them untouched', async () => {
    expect((await patchSession(req('PATCH', 'http://x/api', { recallOtherChats: true }), ctx('nope'))).status).toBe(404)
    expect((await patchSession(req('PATCH', 'http://x/api', { recallOtherChats: true }), ctx('s9'))).status).toBe(404)
    expect(current!.tables.coach_sessions.find((s) => s.id === 's9')?.recall_other_chats).toBeUndefined()
  })
  it('updates the own session', async () => {
    const res = await patchSession(req('PATCH', 'http://x/api', { recallOtherChats: true }), ctx('s1'))
    expect(res.status).toBe(200)
    expect((await res.json()).session.recall_other_chats).toBe(true)
    expect(current!.tables.coach_sessions.find((s) => s.id === 's1')?.recall_other_chats).toBe(true)
  })
})

describe('DELETE sessions/[id]', () => {
  it('401 signed out', async () => {
    authUser = null
    expect((await deleteSession(req('DELETE'), ctx('s1'))).status).toBe(401)
  })
  it('404 for unknown and foreign ids', async () => {
    expect((await deleteSession(req('DELETE'), ctx('nope'))).status).toBe(404)
    expect((await deleteSession(req('DELETE'), ctx('s9'))).status).toBe(404)
    expect(current!.tables.coach_sessions).toHaveLength(3)
  })
  it('default does not summarize and removes messages', async () => {
    const res = await deleteSession(req('DELETE'), ctx('s2'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: 's2', memory: null })
    expect(summarizeChat).not.toHaveBeenCalled()
    expect(current!.tables.coaching_messages.map((m) => m.id)).toEqual(['m1'])
  })
  it('keepHistory=true saves a memory', async () => {
    summarizeChat.mockResolvedValue('kept')
    const res = await deleteSession(req('DELETE', 'http://x/api?keepHistory=true'), ctx('s1'))
    expect(res.status).toBe(200)
    expect((await res.json()).memory).toMatchObject({ title: 'Old' })
    expect(current!.tables.coach_memories).toHaveLength(3)
  })
  it('502 and nothing deleted when the summary fails', async () => {
    summarizeChat.mockRejectedValue(new Error('x'))
    const res = await deleteSession(req('DELETE', 'http://x/api?keepHistory=true'), ctx('s1'))
    expect(res.status).toBe(502)
    expect(current!.tables.coach_sessions).toHaveLength(3)
    expect(current!.tables.coaching_messages).toHaveLength(3)
  })
})

describe('memories', () => {
  it('401 signed out', async () => {
    authUser = null
    expect((await listMemories()).status).toBe(401)
    expect((await patchMemory(req('PATCH', 'http://x', { summary: 'a' }), ctx('k1'))).status).toBe(401)
    expect((await deleteMemory(req('DELETE'), ctx('k1'))).status).toBe(401)
  })
  it('lists only own memories', async () => {
    const res = await listMemories()
    expect((await res.json()).memories.map((m: { id: string }) => m.id)).toEqual(['k1'])
  })
  it('PATCH edits own memory, validates, 404 foreign', async () => {
    const ok = await patchMemory(req('PATCH', 'http://x', { summary: ' new ', title: 'Hey' }), ctx('k1'))
    expect(ok.status).toBe(200)
    expect(current!.tables.coach_memories[0]).toMatchObject({ summary: 'new', title: 'Hey' })
    expect((await patchMemory(req('PATCH', 'http://x', { summary: 'x'.repeat(2001) }), ctx('k1'))).status).toBe(400)
    expect((await patchMemory(req('PATCH', 'http://x', { title: 'x'.repeat(121) }), ctx('k1'))).status).toBe(400)
    expect((await patchMemory(req('PATCH', 'http://x', { summary: 'a' }), ctx('k9'))).status).toBe(404)
    expect(current!.tables.coach_memories.find((m) => m.id === 'k9')?.summary).toBe('F')
  })
  it('DELETE removes own, 404 foreign', async () => {
    expect((await deleteMemory(req('DELETE'), ctx('k9'))).status).toBe(404)
    expect((await deleteMemory(req('DELETE'), ctx('k1'))).status).toBe(200)
    expect(current!.tables.coach_memories.map((m) => m.id)).toEqual(['k9'])
  })
})

describe('GET history', () => {
  const get = (q = '') => history(new Request(`http://x/api/ai/chat/history${q}`))
  it('401 signed out', async () => {
    authUser = null
    expect((await get()).status).toBe(401)
  })
  it('defaults to the newest session, chat kind only', async () => {
    const body = await (await get()).json()
    expect(body.sessionId).toBe('s2')
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual(['m2'])
  })
  it('filters by sessionId', async () => {
    expect((await (await get('?sessionId=s1')).json()).messages.map((m: { id: string }) => m.id)).toEqual(['m1'])
  })
  it('404 for a foreign or unknown session', async () => {
    expect((await get('?sessionId=s9')).status).toBe(404)
    expect((await get('?sessionId=nope')).status).toBe(404)
  })
  it('empty list when the user has no sessions', async () => {
    authUser = { id: 'u3' }
    current = makeFakeSupabase({ rlsUserId: 'u3' })
    expect(await (await get()).json()).toEqual({ messages: [], sessionId: null })
  })
})
