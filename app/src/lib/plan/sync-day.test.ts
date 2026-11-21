import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeFakeSupabase } from './__fixtures__/fake-supabase'

const importMock = vi.fn()
const connMock = vi.fn()
vi.mock('@/lib/integrations/strava/sync', () => ({ importStravaActivities: (...a: unknown[]) => importMock(...a) }))
vi.mock('@/lib/integrations/strava/tokens', () => ({ getConnection: (...a: unknown[]) => connMock(...a) }))

import { syncPlanDay } from './sync-day'

const NOW = new Date('2026-10-14T12:00:00Z')
const act = (id: string, started_at: string) => ({
  id, user_id: 'u1', sport_type: 'running', started_at, duration_s: 1800, distance_m: 5000,
  avg_pace_s_per_km: 360, avg_hr_bpm: 150, source: 'strava',
})
const db = () =>
  makeFakeSupabase({
    tables: {
      activities: [act('a1', '2026-10-12T07:00:00Z'), act('a2', '2026-10-13T07:00:00Z')],
      planned_sessions: [{ id: 's1', user_id: 'u1', completed_activity_id: 'a2' }],
    },
  }).client

describe('syncPlanDay', () => {
  beforeEach(() => {
    importMock.mockReset()
    connMock.mockReset()
  })

  it('rejects invalid and future dates without calling Strava', async () => {
    for (const d of ['nope', '2026-02-31', '2026-10-15', undefined]) {
      const r = await syncPlanDay(db(), db(), 'u1', d, 'UTC', NOW)
      expect(r).toMatchObject({ ok: false, status: 400 })
    }
    expect(connMock).not.toHaveBeenCalled()
  })

  it('not connected: returns saved activities and skips import', async () => {
    connMock.mockResolvedValue(null)
    const r = await syncPlanDay(db(), db(), 'u1', '2026-10-12', 'UTC', NOW)
    expect(r).toMatchObject({ ok: true, strava: 'not_connected', imported: 0 })
    expect(r.ok && r.activities.map((a) => a.id)).toEqual(['a1'])
    expect(importMock).not.toHaveBeenCalled()
  })

  it('imports the local day window, then a second call imports 0', async () => {
    connMock.mockResolvedValue({ user_id: 'u1' })
    importMock.mockResolvedValueOnce({ imported: 1, skipped: 0, failed: 0, rateLimited: false, details: [] })
    importMock.mockResolvedValueOnce({ imported: 0, skipped: 1, failed: 0, rateLimited: false, details: [] })
    const first = await syncPlanDay(db(), db(), 'u1', '2026-10-12', 'UTC', NOW)
    const second = await syncPlanDay(db(), db(), 'u1', '2026-10-12', 'UTC', NOW)
    expect(first).toMatchObject({ ok: true, strava: 'synced', imported: 1 })
    expect(second).toMatchObject({ ok: true, strava: 'synced', imported: 0 })
    const opts = importMock.mock.calls[0][2]
    expect(opts).toMatchObject({ limit: 10, withStreams: false, after: Date.UTC(2026, 9, 12) / 1000 - 1, before: Date.UTC(2026, 9, 13) / 1000 })
  })

  it('maps Strava failures to a status and still returns activities', async () => {
    connMock.mockResolvedValue({ user_id: 'u1' })
    importMock.mockRejectedValueOnce(new Error('STRAVA_RATE_LIMITED'))
    importMock.mockRejectedValueOnce(new Error('STRAVA_ATHLETE_LIMIT'))
    importMock.mockRejectedValueOnce(new Error('STRAVA_UNAUTHORIZED'))
    importMock.mockRejectedValueOnce(new Error('boom'))
    const out = []
    for (let i = 0; i < 4; i++) out.push(await syncPlanDay(db(), db(), 'u1', '2026-10-12', 'UTC', NOW))
    expect(out.map((r) => r.ok && r.strava)).toEqual(['rate_limited', 'athlete_limit', 'unauthorized', 'error'])
    expect(out.every((r) => r.ok && r.activities.length === 1)).toBe(true)
  })

  it('reports rate limiting flagged by a partial import', async () => {
    connMock.mockResolvedValue({ user_id: 'u1' })
    importMock.mockResolvedValue({ imported: 1, skipped: 2, failed: 0, rateLimited: true, details: [] })
    const r = await syncPlanDay(db(), db(), 'u1', '2026-10-12', 'UTC', NOW)
    expect(r).toMatchObject({ strava: 'rate_limited', imported: 1 })
  })

  it('allows today and excludes linked activities', async () => {
    connMock.mockResolvedValue(null)
    const r = await syncPlanDay(db(), db(), 'u1', '2026-10-13', 'UTC', NOW)
    expect(r.ok && r.activities).toEqual([])
    expect((await syncPlanDay(db(), db(), 'u1', '2026-10-14', 'UTC', NOW)).ok).toBe(true)
  })
})
