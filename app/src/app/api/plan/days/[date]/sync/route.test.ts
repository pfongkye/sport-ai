import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeFakeSupabase } from '@/lib/plan/__fixtures__/fake-supabase'

let current: ReturnType<typeof makeFakeSupabase> | null = null
let authUser: { id: string } | null = null
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    ...(current!.client as object),
    auth: { getUser: async () => ({ data: { user: authUser } }) },
  }),
  createAdminClient: async () => current!.client,
}))
vi.mock('@/lib/integrations/strava/tokens', () => ({ getConnection: async () => null }))
vi.mock('@/lib/integrations/strava/sync', () => ({ importStravaActivities: vi.fn() }))

import { POST } from './route'

const call = (date: string, cookie = 'tz=UTC') =>
  POST(new Request('http://x/api', { method: 'POST', headers: { cookie } }), { params: Promise.resolve({ date }) })
const today = new Date().toISOString().slice(0, 10)

describe('POST /api/plan/days/[date]/sync', () => {
  beforeEach(() => {
    current = makeFakeSupabase({
      tables: {
        activities: [{ id: 'a1', user_id: 'u1', sport_type: 'running', started_at: '2020-01-02T07:00:00Z', duration_s: 60, distance_m: 100, avg_pace_s_per_km: null, avg_hr_bpm: null, source: 'manual' }],
        planned_sessions: [],
        user_settings: [{ user_id: 'u1', timezone: 'UTC' }],
      },
    })
    authUser = { id: 'u1' }
  })

  it('401 when signed out', async () => {
    authUser = null
    expect((await call('2020-01-02')).status).toBe(401)
  })

  it('400 for invalid and future dates', async () => {
    expect((await call('garbage')).status).toBe(400)
    expect((await call('2999-01-01')).status).toBe(400)
  })

  it('200 when Strava is not connected', async () => {
    const res = await call('2020-01-02')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ date: '2020-01-02', strava: 'not_connected', imported: 0 })
    expect((await call(today)).status).toBe(200)
  })
})
