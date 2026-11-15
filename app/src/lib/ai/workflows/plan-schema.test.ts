import { describe, it, expect } from 'vitest'
import { planSchema, planToRows, type PlanDraft } from './plan-schema'

const plan: PlanDraft = {
  title: 'Plan',
  goal: 'Marathon',
  startDate: '2026-10-12',
  endDate: '2026-12-06',
  sessions: [
    {
      scheduledDate: '2026-10-12',
      sportType: 'run',
      sessionType: ' long run ',
      description: ' Easy long. ',
      targetDistanceM: 18000.4,
      targetDurationS: 5400.6,
      targetHrZone: 2,
    },
    {
      scheduledDate: '2026-10-14',
      sportType: 'gym',
      sessionType: 'strength',
      description: '',
      targetDistanceM: 0,
      targetDurationS: null,
      targetHrZone: null,
    },
  ],
}

describe('planToRows', () => {
  const rows = planToRows(plan, 'user-1', 'plan-1')
  it('maps camelCase to the planned_sessions columns, pending, scoped to user/plan', () => {
    expect(rows[0]).toEqual({
      plan_id: 'plan-1',
      user_id: 'user-1',
      scheduled_date: '2026-10-12',
      sport_type: 'run',
      session_type: 'long run',
      description: 'Easy long.',
      target_distance_m: 18000,
      target_duration_s: 5401,
      target_hr_zone: 2,
      status: 'pending',
    })
  })
  it('nulls non-positive or empty values so DB CHECK constraints hold', () => {
    expect(rows[1].target_distance_m).toBeNull()
    expect(rows[1].description).toBeNull()
    expect(rows[1].target_hr_zone).toBeNull()
  })
})

describe('planSchema', () => {
  it('accepts a valid plan and rejects an empty session list', () => {
    expect(planSchema.safeParse(plan).success).toBe(true)
    expect(planSchema.safeParse({ ...plan, sessions: [] }).success).toBe(false)
  })
  it('rejects an HR zone outside 1-5', () => {
    const bad = { ...plan, sessions: [{ ...plan.sessions[0], targetHrZone: 7 }] }
    expect(planSchema.safeParse(bad).success).toBe(false)
  })
})
