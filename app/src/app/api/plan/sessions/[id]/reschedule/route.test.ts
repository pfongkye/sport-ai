import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeFakeSupabase } from '@/lib/plan/__fixtures__/fake-supabase'

// Route does its own auth via createClient(); mock it with a fake RLS-scoped client.
let current: ReturnType<typeof makeFakeSupabase> | null = null
let authUser: { id: string } | null = null
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    ...(current!.client as object),
    auth: { getUser: async () => ({ data: { user: authUser } }) },
  }),
}))

import { PATCH } from './route'

const TODAY_ISO = new Date().toISOString().slice(0, 10)
const day = (offset: number) => {
  const d = new Date(`${TODAY_ISO}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

function setup(sessions: Record<string, unknown>[], userId = 'u1') {
  current = makeFakeSupabase({
    rlsUserId: userId,
    tables: {
      user_settings: [{ user_id: userId, timezone: 'UTC' }],
      training_plans: [{ id: 'plan-1', user_id: userId, start_date: day(-7), end_date: day(60) }],
      planned_sessions: sessions,
    },
  })
  authUser = { id: userId }
}

const call = (id: string, body: unknown) =>
  PATCH(
    new Request('http://x/api', { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) }
  )

const session = (over: Record<string, unknown> = {}) => ({
  id: 's1', plan_id: 'plan-1', user_id: 'u1', scheduled_date: day(3), status: 'pending', ai_notes: null, ...over,
})

describe('PATCH /api/plan/sessions/[id]/reschedule', () => {
  beforeEach(() => { current = null; authUser = null })

  it('moves a future pending session, sets status=modified and a manual-move trace', async () => {
    setup([session()])
    const res = await call('s1', { date: day(5) })
    expect(res.status).toBe(200)
    const row = current!.tables.planned_sessions[0]
    expect(row.scheduled_date).toBe(day(5))
    expect(row.status).toBe('modified')
    expect(String(row.ai_notes)).toContain('Moved manually')
  })

  it('does not touch training targets (only date, status, note)', async () => {
    setup([session({ target_distance_m: 10000, description: 'keep me' })])
    await call('s1', { date: day(5) })
    const row = current!.tables.planned_sessions[0]
    expect(row.target_distance_m).toBe(10000)
    expect(row.description).toBe('keep me')
  })

  it('rejects a past session', async () => {
    setup([session({ scheduled_date: day(-2) })])
    const res = await call('s1', { date: day(5) })
    expect(res.status).toBe(409)
    expect(current!.tables.planned_sessions[0].scheduled_date).toBe(day(-2))
  })

  it.each(['completed', 'skipped', 'modified'])('rejects a future %s session', async (status) => {
    setup([session({ status })])
    const res = await call('s1', { date: day(5) })
    expect(res.status).toBe(409)
    expect(current!.tables.planned_sessions[0].scheduled_date).toBe(day(3))
  })

  it('rejects a non-owner (RLS hides the row → 404) and does not modify it', async () => {
    setup([session({ user_id: 'someone-else' })], 'u1')
    const res = await call('s1', { date: day(5) })
    expect(res.status).toBe(404)
    expect(current!.tables.planned_sessions[0].scheduled_date).toBe(day(3))
  })

  it('rejects moving into the past, outside the plan, or with a bad date', async () => {
    setup([session()])
    expect((await call('s1', { date: day(-1) })).status).toBe(400)
    expect((await call('s1', { date: day(90) })).status).toBe(400)
    expect((await call('s1', { date: 'tomorrow' })).status).toBe(400)
    expect((await call('s1', {})).status).toBe(400)
    expect(current!.tables.planned_sessions[0].scheduled_date).toBe(day(3))
  })

  it('401 when unauthenticated', async () => {
    setup([session()])
    authUser = null
    expect((await call('s1', { date: day(5) })).status).toBe(401)
  })
})
