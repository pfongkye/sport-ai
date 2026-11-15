import { describe, it, expect } from 'vitest'
import { adjustUpcomingSessions } from './adjust'
import { makeFakeSupabase } from './__fixtures__/fake-supabase'

const TODAY = '2026-10-12'
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

function setup() {
  return makeFakeSupabase({
    tables: {
      training_plans: [{ id: 'p', user_id: 'u1', start_date: '2026-10-01', end_date: '2026-12-01' }],
      planned_sessions: [
        { id: A, plan_id: 'p', user_id: 'u1', scheduled_date: '2026-10-15', status: 'pending', target_distance_m: 10000 },
        { id: B, plan_id: 'p', user_id: 'u1', scheduled_date: '2026-10-08', status: 'pending', target_distance_m: 10000 },
        { id: C, plan_id: 'p', user_id: 'u1', scheduled_date: '2026-10-20', status: 'completed', target_distance_m: 10000 },
      ],
    },
  })
}

describe('adjustUpcomingSessions', () => {
  it('edits a future pending session and records the reason', async () => {
    const { client, tables } = setup()
    const out = await adjustUpcomingSessions(client, 'u1', [{ sessionId: A, targetDistanceM: 6000.4, reason: 'tired' }], TODAY)
    expect(out.adjusted).toHaveLength(1)
    expect(tables.planned_sessions[0].target_distance_m).toBe(6000)
    expect(tables.planned_sessions[0].ai_notes).toBe('Adjusted by coach: tired')
    expect(tables.planned_sessions[0].status).toBe('pending')
  })

  it('refuses past and completed sessions and leaves them untouched', async () => {
    const { client, tables } = setup()
    const out = await adjustUpcomingSessions(
      client, 'u1',
      [{ sessionId: B, targetDistanceM: 1 }, { sessionId: C, targetDistanceM: 1 }],
      TODAY
    )
    expect(out.adjusted).toEqual([])
    expect(out.rejected).toHaveLength(2)
    expect(tables.planned_sessions[1].target_distance_m).toBe(10000)
    expect(tables.planned_sessions[2].target_distance_m).toBe(10000)
  })

  it('returns a graceful rejection (no throw) for a non-UUID id or another user\'s session', async () => {
    const { client } = setup()
    const out = await adjustUpcomingSessions(client, 'someone-else', [{ sessionId: 'latest' }, { sessionId: A, targetDistanceM: 5000 }], TODAY)
    expect(out.adjusted).toEqual([])
    expect(out.rejected.map((r) => r.sessionId)).toEqual(['latest', A])
  })

  it('validates a new date (past or outside the plan is rejected, valid is applied)', async () => {
    const { client, tables } = setup()
    const bad = await adjustUpcomingSessions(client, 'u1', [{ sessionId: A, scheduledDate: '2026-10-01' }, { sessionId: A, scheduledDate: '2027-05-01' }], TODAY)
    expect(bad.rejected).toHaveLength(2)
    const ok = await adjustUpcomingSessions(client, 'u1', [{ sessionId: A, scheduledDate: '2026-10-17' }], TODAY)
    expect(ok.adjusted).toHaveLength(1)
    expect(tables.planned_sessions[0].scheduled_date).toBe('2026-10-17')
  })

  it('ignores out-of-range HR zone and rejects an item with nothing valid to change', async () => {
    const { client } = setup()
    const out = await adjustUpcomingSessions(client, 'u1', [{ sessionId: A, targetHrZone: 9, targetDistanceM: -5 }], TODAY)
    expect(out.rejected[0].reason).toMatch(/Nothing valid/)
  })
})
