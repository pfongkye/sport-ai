import { describe, it, expect } from 'vitest'
import { makeFakeSupabase } from './__fixtures__/fake-supabase'
import { loadActivePlan } from './load-plan'
import { computeTrainingRecap } from '@/lib/ai/workflows/training-recap'

const USER = 'u1'
const NOW = new Date('2026-10-12T08:00:00Z')

function seed(recap: unknown) {
  return makeFakeSupabase({
    tables: {
      training_plans: [
        { id: 'p1', user_id: USER, title: 'T', goal: 'g', start_date: '2026-10-12', end_date: '2026-12-06', status: 'active', recap },
      ],
      planned_sessions: [],
      user_settings: [{ user_id: USER, timezone: 'UTC' }],
    },
  }).client
}

describe('loadActivePlan recap', () => {
  it('returns the stored recap snapshot with the plan', async () => {
    const recap = computeTrainingRecap([], { trainingDays: ['monday'] }, '2026-10-12')
    const active = await loadActivePlan(seed(JSON.parse(JSON.stringify(recap))), USER, NOW)
    expect(active?.plan.recap).toEqual(recap)
  })
  it('returns recap null for plans created before the column (null) or an unknown schema', async () => {
    expect((await loadActivePlan(seed(null), USER, NOW))?.plan.recap).toBeNull()
    expect((await loadActivePlan(seed({ schemaVersion: 99 }), USER, NOW))?.plan.recap).toBeNull()
  })
})

describe('loadActivePlan activities', () => {
  const act = (id: string, started_at: string) => ({
    id, user_id: USER, sport_type: 'run', started_at, duration_s: 1, distance_m: 1, avg_pace_s_per_km: null, avg_hr_bpm: null, source: 'manual',
  })
  it('returns unlinked activities bucketed by local date and omits linked ones', async () => {
    const { client } = makeFakeSupabase({
      tables: {
        training_plans: [{ id: 'p1', user_id: USER, title: 'T', goal: 'g', start_date: '2026-10-12', end_date: '2026-12-06', status: 'active', recap: null }],
        planned_sessions: [{ id: 's1', user_id: USER, plan_id: 'p1', scheduled_date: '2026-10-13', status: 'completed', completed_activity_id: 'linked' }],
        activities: [
          act('linked', '2026-10-13T07:00:00Z'),
          act('free', '2026-10-13T23:30:00Z'),
          act('before', '2026-09-01T07:00:00Z'),
        ],
        user_settings: [{ user_id: USER, timezone: 'Pacific/Auckland' }],
      },
    })
    const active = await loadActivePlan(client, USER, NOW)
    expect(active?.activities.map((a) => [a.id, a.local_date])).toEqual([['free', '2026-10-14']])
  })
})
