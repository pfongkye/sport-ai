import { describe, it, expect } from 'vitest'
import { linkActivityToPlannedSession } from './link-activity'
import { makeFakeSupabase } from './__fixtures__/fake-supabase'

function setup(sessions: Record<string, unknown>[], tz = 'UTC') {
  return makeFakeSupabase({
    tables: {
      user_settings: [{ user_id: 'u1', timezone: tz }],
      training_plans: [
        { id: 'active', user_id: 'u1', status: 'active', created_at: '2' },
        { id: 'old', user_id: 'u1', status: 'archived', created_at: '1' },
      ],
      planned_sessions: sessions,
    },
  })
}
const sess = (over: Record<string, unknown> = {}) => ({
  id: 's1', plan_id: 'active', user_id: 'u1', scheduled_date: '2026-10-12', sport_type: 'run', status: 'pending', created_at: '1', ...over,
})

describe('linkActivityToPlannedSession', () => {
  it('completes the same-day same-sport pending session and links the activity', async () => {
    const { client, tables } = setup([sess()])
    const id = await linkActivityToPlannedSession(client, 'u1', { id: 'act-1', sportType: 'run', startedAt: '2026-10-12T07:00:00Z' })
    expect(id).toBe('s1')
    expect(tables.planned_sessions[0]).toMatchObject({ status: 'completed', completed_activity_id: 'act-1' })
  })
  it('does not link a different sport, a different day, a non-pending or an archived-plan session', async () => {
    const { client, tables } = setup([
      sess({ id: 'a', sport_type: 'gym' }),
      sess({ id: 'b', scheduled_date: '2026-10-13' }),
      sess({ id: 'c', status: 'skipped' }),
      sess({ id: 'd', plan_id: 'old' }),
    ])
    const id = await linkActivityToPlannedSession(client, 'u1', { id: 'act-1', sportType: 'run', startedAt: '2026-10-12T07:00:00Z' })
    expect(id).toBeNull()
    expect(tables.planned_sessions.every((s) => s.completed_activity_id === undefined)).toBe(true)
  })
  it('completes a moved (modified) session that has no activity yet', async () => {
    const { client, tables } = setup([sess({ status: 'modified' })])
    const id = await linkActivityToPlannedSession(client, 'u1', { id: 'act-1', sportType: 'run', startedAt: '2026-10-12T07:00:00Z' })
    expect(id).toBe('s1')
    expect(tables.planned_sessions[0]).toMatchObject({ status: 'completed', completed_activity_id: 'act-1' })
  })
  it('does not relink a session that already has an activity, and prefers the earliest match', async () => {
    const { client, tables } = setup([
      sess({ id: 'x', status: 'modified', completed_activity_id: 'old', created_at: '0' }),
      sess({ id: 'late', status: 'modified', created_at: '5' }),
      sess({ id: 'early', created_at: '2' }),
    ])
    const id = await linkActivityToPlannedSession(client, 'u1', { id: 'act-1', sportType: 'run', startedAt: '2026-10-12T07:00:00Z' })
    expect(id).toBe('early')
    expect(tables.planned_sessions.find((s) => s.id === 'x')?.completed_activity_id).toBe('old')
    expect(tables.planned_sessions.find((s) => s.id === 'late')?.status).toBe('modified')
  })
  it('uses the athlete\'s local day (late-evening run in Paris is the next UTC-day-ahead)', async () => {
    const { client } = setup([sess({ scheduled_date: '2026-10-13' })], 'Europe/Paris')
    const id = await linkActivityToPlannedSession(client, 'u1', { id: 'act-1', sportType: 'run', startedAt: '2026-10-12T22:30:00Z' })
    expect(id).toBe('s1')
  })
  it('is non-fatal: swallows errors', async () => {
    const broken = { from: () => { throw new Error('db down') } } as never
    await expect(linkActivityToPlannedSession(broken, 'u1', { id: 'a', sportType: 'run', startedAt: '2026-10-12T07:00:00Z' })).resolves.toBeNull()
  })
  it('links an activity at 23:30 local that is already the next UTC day (Honolulu, UTC-10)', async () => {
    // 2026-10-13T09:30Z = 2026-10-12 23:30 in Honolulu.
    const { client } = setup([sess({ scheduled_date: '2026-10-12' })], 'Pacific/Honolulu')
    const id = await linkActivityToPlannedSession(client, 'u1', { id: 'act-1', sportType: 'run', startedAt: '2026-10-13T09:30:00Z' })
    expect(id).toBe('s1')
  })
  it('links an activity at 00:30 local that is still the previous UTC day (Auckland, UTC+13)', async () => {
    // 2026-01-14T11:30Z = 2026-01-15 00:30 in Auckland.
    const { client } = setup([sess({ scheduled_date: '2026-01-15' })], 'Pacific/Auckland')
    const id = await linkActivityToPlannedSession(client, 'u1', { id: 'act-1', sportType: 'run', startedAt: '2026-01-14T11:30:00Z' })
    expect(id).toBe('s1')
  })
  it('the request zone wins over the stored zone', async () => {
    const { client } = setup([sess({ scheduled_date: '2026-01-15' })], 'UTC')
    const startedAt = '2026-01-14T11:30:00Z'
    expect(await linkActivityToPlannedSession(client, 'u1', { id: 'a', sportType: 'run', startedAt })).toBeNull()
    expect(await linkActivityToPlannedSession(client, 'u1', { id: 'a', sportType: 'run', startedAt }, 'Pacific/Auckland')).toBe('s1')
  })
})
