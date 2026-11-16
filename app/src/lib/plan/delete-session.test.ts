import { describe, it, expect } from 'vitest'
import { deleteSession, isDeletable } from './delete-session'
import { makeFakeSupabase } from './__fixtures__/fake-supabase'

const row = (over: Record<string, unknown> = {}) => ({
  id: 's1', plan_id: 'p1', user_id: 'u1', scheduled_date: '2026-10-20', status: 'pending', completed_activity_id: null, ...over,
})

describe('isDeletable', () => {
  it.each(['pending', 'modified', 'skipped'])('allows %s without an activity', (status) => {
    expect(isDeletable({ status })).toBe(true)
  })
  it('refuses completed sessions and any session with a linked activity', () => {
    expect(isDeletable({ status: 'completed' })).toBe(false)
    expect(isDeletable({ status: 'pending', completed_activity_id: 'a1' })).toBe(false)
  })
})

describe('deleteSession', () => {
  it('deletes an owned pending session (past or future) and leaves siblings alone', async () => {
    const { client, tables } = makeFakeSupabase({
      rlsUserId: 'u1',
      tables: { planned_sessions: [row(), row({ id: 's2', scheduled_date: '2020-01-01' })] },
    })
    const r = await deleteSession(client, 'u1', 's2')
    expect(r).toEqual({ ok: true, sessionId: 's2', date: '2020-01-01' })
    expect(tables.planned_sessions.map((s) => s.id)).toEqual(['s1'])
  })

  it('returns 404 for another user\'s session and does not delete it', async () => {
    const { client, tables } = makeFakeSupabase({ tables: { planned_sessions: [row({ user_id: 'u2' })] } })
    const r = await deleteSession(client, 'u1', 's1')
    expect(r).toMatchObject({ ok: false, status: 404 })
    expect(tables.planned_sessions).toHaveLength(1)
  })

  it('returns 409 for a completed session and keeps it', async () => {
    const { client, tables } = makeFakeSupabase({
      tables: { planned_sessions: [row({ status: 'completed', completed_activity_id: 'a1' })] },
    })
    const r = await deleteSession(client, 'u1', 's1')
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(tables.planned_sessions).toHaveLength(1)
  })

  it('reports 409 when the DELETE fails', async () => {
    const { client } = makeFakeSupabase({ failOn: ['planned_sessions.delete'], tables: { planned_sessions: [row()] } })
    expect(await deleteSession(client, 'u1', 's1')).toMatchObject({ ok: false, status: 409 })
  })
})
