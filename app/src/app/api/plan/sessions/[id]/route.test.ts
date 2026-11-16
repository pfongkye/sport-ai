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

import { DELETE } from './route'

const session = (over: Record<string, unknown> = {}) => ({
  id: 's1', plan_id: 'p1', user_id: 'u1', scheduled_date: '2026-10-20', status: 'pending', completed_activity_id: null, ...over,
})
const call = (id: string) =>
  DELETE(new Request('http://x/api', { method: 'DELETE' }), { params: Promise.resolve({ id }) })

describe('DELETE /api/plan/sessions/[id]', () => {
  beforeEach(() => {
    current = makeFakeSupabase({ rlsUserId: 'u1', tables: { planned_sessions: [session(), session({ id: 's2', status: 'completed', completed_activity_id: 'a1' })] } })
    authUser = { id: 'u1' }
  })

  it('401 when signed out and nothing is deleted', async () => {
    authUser = null
    expect((await call('s1')).status).toBe(401)
    expect(current!.tables.planned_sessions).toHaveLength(2)
  })

  it('200 and removes only that session', async () => {
    const res = await call('s1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sessionId: 's1', date: '2026-10-20' })
    expect(current!.tables.planned_sessions.map((s) => s.id)).toEqual(['s2'])
  })

  it('404 for an unknown id or another user\'s session (RLS)', async () => {
    expect((await call('nope')).status).toBe(404)
    authUser = { id: 'u2' }
    expect((await call('s1')).status).toBe(404)
    expect(current!.tables.planned_sessions).toHaveLength(2)
  })

  it('409 for a completed session', async () => {
    expect((await call('s2')).status).toBe(409)
    expect(current!.tables.planned_sessions).toHaveLength(2)
  })
})
