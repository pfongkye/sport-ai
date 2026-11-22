import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { makeFakeSupabase } from '@/lib/plan/__fixtures__/fake-supabase'

let current: ReturnType<typeof makeFakeSupabase> | null = null
const rpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    ...(current!.client as object),
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  }),
  createAdminClient: async () => ({ ...(current!.client as object), rpc }),
}))
vi.mock('@/lib/ai/provider', () => ({
  resolveUserAISettings: async () => ({ settings: {}, userApiKey: userKey }),
}))
vi.mock('@/lib/ai/readiness', () => ({ computeReadiness: async () => null }))
vi.mock('@/lib/ai/agents/coach', () => ({
  buildCoachAgent: async () => ({}),
  streamAgentText: async () => ({
    textStream: (async function* () {
      yield 'Hello'
    })(),
  }),
}))

import { POST } from './route'

let userKey: string | null = 'sk-test'
const VEC = [0.1, 0.2, 0.3]
const embeddingInputs: string[] = []
const fetchMock = vi.fn()

function post(sessionId: string) {
  return POST(
    new Request('http://x/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ sessionId, messages: [{ role: 'user', content: 'my knee hurts' }] }),
    })
  )
}

async function drain(res: Response) {
  const text = await res.text()
  // allow the post-stream assistant persistence to finish
  await new Promise((r) => setTimeout(r, 20))
  return text
}

beforeEach(() => {
  userKey = 'sk-test'
  embeddingInputs.length = 0
  rpc.mockReset()
  rpc.mockResolvedValue({ data: [], error: null })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
    embeddingInputs.push(JSON.parse(init.body).input)
    return new Response(JSON.stringify({ data: [{ embedding: VEC }] }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  current = makeFakeSupabase({
    rlsUserId: 'u1',
    tables: {
      profiles: [{ id: 'u1' }],
      coach_sessions: [
        { id: 's1', user_id: 'u1', title: 'Chat', updated_at: '2026-01-01T00:00:00Z', recall_other_chats: false },
        { id: 's2', user_id: 'u1', title: 'Chat', updated_at: '2026-01-02T00:00:00Z', recall_other_chats: true },
      ],
      coaching_messages: [],
      coach_memories: [],
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.OPENAI_API_KEY
})

const userRow = () =>
  current!.tables.coaching_messages.find((m) => m.role === 'user') as Record<string, unknown>

describe('POST /api/ai/chat retrieval', () => {
  it('embeds the user message once and reuses the vector for RPC and storage', async () => {
    await drain(await post('s1'))
    expect(embeddingInputs.filter((i) => i === 'my knee hurts')).toHaveLength(1)
    expect(rpc).toHaveBeenCalledTimes(1)
    const args = rpc.mock.calls[0][1]
    expect(args.p_embedding).toBe('[0.1,0.2,0.3]')
    expect(userRow().embedding).toBe(args.p_embedding)
  })

  it('scopes retrieval to the chat when recallOtherChats is false', async () => {
    await drain(await post('s1'))
    expect(rpc.mock.calls[0][1].p_session_id).toBe('s1')
    expect(rpc.mock.calls[0][1].p_limit).toBe(5)
    expect(rpc.mock.calls[0][1].p_threshold).toBe(0.3)
  })

  it('omits p_session_id when recallOtherChats is true', async () => {
    await drain(await post('s2'))
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_session_id')
  })

  it('still streams with no key: no RPC, null stored embedding', async () => {
    userKey = null
    const res = await post('s1')
    expect(await drain(res)).toBe('Hello')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(userRow().embedding).toBeNull()
  })

  it('still streams when the embeddings request fails', async () => {
    fetchMock.mockImplementation(async () => new Response('boom', { status: 500 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post('s1')
    expect(await drain(res)).toBe('Hello')
    expect(rpc).not.toHaveBeenCalled()
    expect(userRow().embedding).toBeNull()
  })
})
