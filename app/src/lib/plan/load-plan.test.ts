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
