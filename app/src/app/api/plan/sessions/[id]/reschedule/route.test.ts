import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

  it.each(['completed', 'skipped'])('rejects a future %s session', async (status) => {
    setup([session({ status })])
    const res = await call('s1', { date: day(5) })
    expect(res.status).toBe(409)
    expect(current!.tables.planned_sessions[0].scheduled_date).toBe(day(3))
  })

  it('moves a modified session a second time, stays modified and appends the trace', async () => {
    setup([session({ status: 'modified', ai_notes: 'Moved manually from 2026-01-01 to X.' })])
    const first = current!.tables.planned_sessions[0].scheduled_date
    const res = await call('s1', { date: day(6) })
    expect(res.status).toBe(200)
    const row = current!.tables.planned_sessions[0]
    expect(row.status).toBe('modified')
    expect(row.scheduled_date).toBe(day(6))
    expect(row.ai_notes).toBe(`Moved manually from 2026-01-01 to X. | Moved manually from ${first} to ${day(6)}.`)
  })
  it('moves twice in a row through the API', async () => {
    setup([session()])
    expect((await call('s1', { date: day(5) })).status).toBe(200)
    expect((await call('s1', { date: day(7) })).status).toBe(200)
    expect(current!.tables.planned_sessions[0].scheduled_date).toBe(day(7))
    expect(String(current!.tables.planned_sessions[0].ai_notes).match(/Moved manually/g)).toHaveLength(2)
  })
  it('rejects a past modified session and a modified one that already has an activity', async () => {
    setup([session({ id: 'a', status: 'modified', scheduled_date: day(-1) }), session({ id: 'b', status: 'modified', completed_activity_id: 'act-1' })])
    expect((await call('a', { date: day(5) })).status).toBe(409)
    expect((await call('b', { date: day(5) })).status).toBe(409)
  })
  it('allows moving onto a date that already has another session (unchanged behaviour)', async () => {
    setup([session(), session({ id: 's2', scheduled_date: day(5) })])
    expect((await call('s1', { date: day(5) })).status).toBe(200)
    expect(current!.tables.planned_sessions.filter((s) => s.scheduled_date === day(5))).toHaveLength(2)
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

describe('PATCH reschedule: "today" follows the browser zone cookie', () => {
  const callWithTz = (tz: string, id: string, body: unknown) =>
    PATCH(
      new Request('http://x/api', {
        method: 'PATCH',
        headers: { cookie: `tz=${encodeURIComponent(tz)}` },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) }
    )
  const fixed = () => {
    current = makeFakeSupabase({
      rlsUserId: 'u1',
      tables: {
        user_settings: [{ user_id: 'u1', timezone: 'UTC' }],
        training_plans: [{ id: 'plan-1', user_id: 'u1', start_date: '2026-10-01', end_date: '2026-12-01' }],
        planned_sessions: [
          { id: 's1', plan_id: 'plan-1', user_id: 'u1', scheduled_date: '2026-10-12', status: 'pending', ai_notes: null },
        ],
      },
    })
    authUser = { id: 'u1' }
  }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-12T20:00:00Z')) // Oct 13 09:00 in Auckland, Oct 12 10:00 in Honolulu
  })
  afterEach(() => { vi.useRealTimers() })
  it('Auckland: the Oct 12 session is already past', async () => {
    fixed()
    expect((await callWithTz('Pacific/Auckland', 's1', { date: '2026-10-15' })).status).toBe(409)
  })
  it('Honolulu: the Oct 12 session is still today and can be moved', async () => {
    fixed()
    expect((await callWithTz('Pacific/Honolulu', 's1', { date: '2026-10-15' })).status).toBe(200)
  })
})
