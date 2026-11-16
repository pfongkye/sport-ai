import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeFakeSupabase } from '@/lib/plan/__fixtures__/fake-supabase'
import { makeSkeleton, planWithWeeklyKm, validPlanFor } from './plan-fixtures'
import { buildSkeleton } from './plan-skeleton'

// No network, no paid API: mock the AI SDK call and the provider/readiness layers.
const generateObjectMock = vi.fn()
vi.mock('ai', () => ({ generateObject: (...a: unknown[]) => generateObjectMock(...a) }))
vi.mock('../provider', () => ({
  resolveUserAISettings: async () => ({
    settings: { ai_provider: 'openai', ai_model: 'gpt-4o', timezone: 'UTC' },
    userApiKey: null,
  }),
  resolveModel: () => ({}),
}))
vi.mock('../readiness', () => ({ computeReadiness: async () => null }))

import { generateTrainingPlan, PlanGenerationError } from './generate-plan'

const NOW = new Date('2026-10-12T08:00:00Z') // Monday
const GOAL_DATE = '2026-12-06'
const USER = 'user-1'

function seed(extra: Record<string, Record<string, unknown>[]> = {}, failOn: string[] = []) {
  return makeFakeSupabase({
    failOn,
    tables: {
      profiles: [
        { id: USER, primary_goal: 'Marathon 3h30', training_days: ['monday', 'wednesday', 'friday', 'saturday'], sport_prefs: ['run'] },
      ],
      activities: [],
      training_plans: [],
      planned_sessions: [],
      ...extra,
    },
  })
}

describe('generateTrainingPlan (mocked generateObject)', () => {
  beforeEach(() => {
    // Block body on purpose: a function returned from beforeEach is run as a
    // teardown hook, and mockReset() returns the mock itself.
    generateObjectMock.mockReset()
  })

  it('inserts the plan then its sessions, scoped to the user, window set by the skeleton', async () => {
    const sk = makeSkeleton({ goalDate: GOAL_DATE, baseline: 12 })
    generateObjectMock.mockResolvedValue({ object: validPlanFor(sk) })
    const { client, tables, calls } = seed()

    const r = await generateTrainingPlan(client, USER, { goalDate: GOAL_DATE, now: NOW })

    expect(generateObjectMock).toHaveBeenCalledTimes(1) // exactly ONE LLM call
    expect(r.sessionCount).toBe(tables.planned_sessions.length)
    expect(r.sessionCount).toBeGreaterThan(10)
    expect(tables.training_plans).toHaveLength(1)
    expect(tables.training_plans[0]).toMatchObject({
      user_id: USER,
      status: 'active',
      start_date: '2026-10-12',
      end_date: GOAL_DATE,
    })
    expect(tables.planned_sessions.every((s) => s.plan_id === r.planId && s.user_id === USER && s.status === 'pending')).toBe(true)
    const order = calls.filter((c) => c.op === 'insert').map((c) => c.table)
    expect(order).toEqual(['training_plans', 'planned_sessions'])
  })

  it('archives the previous active plan', async () => {
    const sk = makeSkeleton({ goalDate: GOAL_DATE, baseline: 12 })
    generateObjectMock.mockResolvedValue({ object: validPlanFor(sk) })
    const { client, tables } = seed({
      training_plans: [{ id: 'old', user_id: USER, status: 'active' }],
    })
    const r = await generateTrainingPlan(client, USER, { goalDate: GOAL_DATE, now: NOW })
    expect(r.archivedPlanIds).toEqual(['old'])
    expect(tables.training_plans.find((p) => p.id === 'old')?.status).toBe('archived')
    expect(tables.training_plans.filter((p) => p.status === 'active')).toHaveLength(1)
  })

  it('on session-insert failure deletes the new plan and reactivates the old one (no empty plan)', async () => {
    const sk = makeSkeleton({ goalDate: GOAL_DATE, baseline: 12 })
    generateObjectMock.mockResolvedValue({ object: validPlanFor(sk) })
    const { client, tables } = seed(
      { training_plans: [{ id: 'old', user_id: USER, status: 'active' }] },
      ['planned_sessions.insert']
    )
    await expect(generateTrainingPlan(client, USER, { goalDate: GOAL_DATE, now: NOW })).rejects.toMatchObject({
      code: 'PERSIST_FAILED',
    })
    expect(tables.training_plans).toHaveLength(1)
    expect(tables.training_plans[0]).toMatchObject({ id: 'old', status: 'active' })
    expect(tables.planned_sessions).toHaveLength(0)
  })

  it('writes nothing when the model plan breaks a guardrail', async () => {
    const sk = makeSkeleton({ goalDate: GOAL_DATE, baseline: 12 })
    const bad = validPlanFor(sk)
    bad.sessions.push({ ...bad.sessions[0], scheduledDate: '2027-03-01' })
    generateObjectMock.mockResolvedValue({ object: bad })
    const { client, tables, calls } = seed()
    const err = await generateTrainingPlan(client, USER, { goalDate: GOAL_DATE, now: NOW }).catch((e) => e)
    expect(err).toBeInstanceOf(PlanGenerationError)
    expect(err.code).toBe('INVALID_PLAN')
    expect(tables.training_plans).toHaveLength(0)
    expect(calls.some((c) => c.op === 'insert')).toBe(false)
  })

  it('maps a model failure to GENERATION_FAILED and writes nothing', async () => {
    generateObjectMock.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('model unavailable'), { name: 'APICallError' }))
    )
    const { client, tables } = seed()
    const e = await generateTrainingPlan(client, USER, { goalDate: GOAL_DATE, now: NOW }).catch((x) => x)
    expect(e.code).toBe('GENERATION_FAILED')
    expect(tables.training_plans).toHaveLength(0)
  })

  it('rejects a too-soon goal date before calling the model', async () => {
    const { client } = seed()
    await expect(generateTrainingPlan(client, USER, { goalDate: '2026-10-14', now: NOW })).rejects.toMatchObject({
      code: 'GOAL_TOO_SOON',
    })
    expect(generateObjectMock).not.toHaveBeenCalled()
  })

  describe('near-miss recovery', () => {
    const sk = () => makeSkeleton({ goalDate: GOAL_DATE, baseline: 30 })
    // TODAY 2026-10-12, baseline 30: weekly caps 30/33/36.3/...; week 3 jumps 20.1 -> 23.0.
    const NEAR_MISS = [20.1, 20.1, 23.0, 22.0, 22.5, 23, 24, 15]
    // 4 qualifying weeks of 2 x 15 km = 30 km/week, so the recap baseline is 30.
    const ACTS = {
      activities: ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'].flatMap((monday) =>
        ['T07:00:00Z', 'T17:00:00Z'].map((t) => ({
          user_id: USER,
          sport_type: 'run',
          started_at: `${monday}${t}`,
          distance_m: 15000,
          duration_s: 5400,
        }))
      ),
    }
    const HOPELESS = [20.1, 20.1, 40, 22, 22.5, 23, 24, 15]

    it('repairs a 14% jump, persists the plan and returns the adjustment', async () => {
      generateObjectMock.mockResolvedValue({ object: planWithWeeklyKm(sk(), NEAR_MISS) })
      const { client, tables } = seed(ACTS)
      const r = await generateTrainingPlan(client, USER, { goalDate: GOAL_DATE, now: NOW })
      expect(generateObjectMock).toHaveBeenCalledTimes(1)
      expect(r.adjustments).toHaveLength(1)
      expect(r.adjustments[0]).toMatch(/Week of 2026-10-26 reduced from 23\.0 km to 22\.\d km/)
      expect(tables.training_plans).toHaveLength(1)
      const week = tables.planned_sessions.filter((s) => (s.scheduled_date as string) >= '2026-10-26' && (s.scheduled_date as string) <= '2026-11-01')
      const km = week.reduce((a, s) => a + (s.target_distance_m as number), 0) / 1000
      expect(km).toBeLessThanOrEqual(22.11)
      expect(week.every((s) => typeof s.ai_notes === 'string')).toBe(true)
    })

    it('still rejects hard (structural) violations without retrying', async () => {
      const bad = planWithWeeklyKm(sk(), NEAR_MISS)
      bad.sessions.push({ ...bad.sessions[0], scheduledDate: '2027-03-01' })
      generateObjectMock.mockResolvedValue({ object: bad })
      const { client, tables } = seed()
      const err = await generateTrainingPlan(client, USER, { goalDate: GOAL_DATE, now: NOW }).catch((e) => e)
      expect(err.code).toBe('INVALID_PLAN')
      expect(generateObjectMock).toHaveBeenCalledTimes(1)
      expect(tables.training_plans).toHaveLength(0)
    })

    it('retries exactly once with the violations as feedback, then rejects', async () => {
      generateObjectMock.mockResolvedValue({ object: planWithWeeklyKm(sk(), HOPELESS) })
      const { client, tables } = seed(ACTS)
      const err = await generateTrainingPlan(client, USER, { goalDate: GOAL_DATE, now: NOW }).catch((e) => e)
      expect(err).toBeInstanceOf(PlanGenerationError)
      expect(err.code).toBe('INVALID_PLAN')
      expect(generateObjectMock).toHaveBeenCalledTimes(2)
      const [first, second] = generateObjectMock.mock.calls.map((c) => (c[0] as { prompt: string }).prompt)
      expect(first).not.toMatch(/PREVIOUS ATTEMPT WAS REJECTED/)
      expect(second).toMatch(/PREVIOUS ATTEMPT WAS REJECTED/)
      expect(second).toMatch(/Week of 2026-10-26/)
      expect(tables.training_plans).toHaveLength(0)
    })

    it('persists when the retry succeeds', async () => {
      generateObjectMock
        .mockResolvedValueOnce({ object: planWithWeeklyKm(sk(), HOPELESS) })
        .mockResolvedValueOnce({ object: validPlanFor(sk()) })
      const { client, tables } = seed(ACTS)
      const r = await generateTrainingPlan(client, USER, { goalDate: GOAL_DATE, now: NOW })
      expect(generateObjectMock).toHaveBeenCalledTimes(2)
      expect(tables.training_plans).toHaveLength(1)
      expect(r.adjustments).toEqual([])
    })

    it('tells the model each week\'s maximum km (previous week x 1.10 and the absolute cap)', async () => {
      generateObjectMock.mockResolvedValue({ object: validPlanFor(sk()) })
      const { client } = seed(ACTS)
      await generateTrainingPlan(client, USER, { goalDate: GOAL_DATE, now: NOW })
      const { prompt, system } = generateObjectMock.mock.calls[0][0] as { prompt: string; system: string }
      const weeks = JSON.parse(prompt.split('Weekly skeleton (JSON):\n')[1].split('\n')[0]) as { targetRunKm: number; maxRunKm: number }[]
      expect(weeks[0].maxRunKm).toBeCloseTo(weeks[0].targetRunKm * 1.15, 1)
      expect(weeks[2].maxRunKm).toBeCloseTo(Math.min(weeks[2].targetRunKm * 1.15, weeks[1].targetRunKm * 1.1), 1)
      expect(prompt).toMatch(/sum of the run session distances/)
      expect(system).toMatch(/maxRunKm/)
    })
  })
})

describe('training recap in the workflow', () => {
  // 4 qualifying weeks, 2 easy runs each (pace 6:00/km, HR 140, max HR 190) + a long run.
  const acts = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'].flatMap((m) => [
    { user_id: USER, sport_type: 'run', started_at: `${m}T07:00:00Z`, distance_m: 8000, duration_s: 2880, avg_hr_bpm: 140, max_hr_bpm: 190 },
    { user_id: USER, sport_type: 'run', started_at: `${m}T17:00:00Z`, distance_m: 8000, duration_s: 2880, avg_hr_bpm: 140, max_hr_bpm: 190 },
    { user_id: USER, sport_type: 'run', started_at: `${m}T19:00:00Z`, distance_m: 16000, duration_s: 6000, avg_hr_bpm: 142, max_hr_bpm: 190 },
  ])
  beforeEach(() => {
    generateObjectMock.mockReset()
  })

  it('puts the recap block in the prompt instead of the per-sport line, and stores the snapshot', async () => {
    const sk = makeSkeleton({ goalDate: GOAL_DATE, baseline: 32 })
    generateObjectMock.mockResolvedValue({ object: validPlanFor(sk) })
    const { client, tables } = seed({ activities: acts })
    const r = await generateTrainingPlan(client, USER, { goalDate: GOAL_DATE, now: NOW })
    const { prompt, system } = generateObjectMock.mock.calls[0][0] as { prompt: string; system: string }
    expect(prompt).toMatch(/=== ATHLETE TRAINING RECAP/)
    expect(prompt).toMatch(/=== END RECAP ===/)
    expect(prompt).toMatch(/Weeks used: 4 of 6/)
    expect(prompt).toMatch(/Easy pace: 6:00 \/km/)
    expect(prompt).not.toMatch(/Recent 4 weeks/)
    expect(prompt).not.toMatch(/HISTORY IS SPARSE/)
    expect(system).toMatch(/ATHLETE TRAINING RECAP/)
    expect(r.recap.baseline.weeklyKm).toBe(32)
    const stored = tables.training_plans[0].recap as { schemaVersion: number; qualifyingWeeks: number; baseline: { weeklyKm: number } }
    expect(stored).toMatchObject({ schemaVersion: 1, qualifyingWeeks: 4, baseline: { weeklyKm: 32 } })
  })

  it('derives durations from the easy pace and adds the bpm range to descriptions', async () => {
    const sk = makeSkeleton({ goalDate: GOAL_DATE, baseline: 32 })
    generateObjectMock.mockResolvedValue({ object: validPlanFor(sk) })
    const { client, tables } = seed({ activities: acts })
    await generateTrainingPlan(client, USER, { goalDate: GOAL_DATE, now: NOW })
    const easy = tables.planned_sessions.find((s) => s.session_type === 'easy')!
    expect(easy.target_duration_s).toBe(Math.round(((easy.target_distance_m as number) / 1000) * 360))
    expect(easy.description).toMatch(/Target HR 114-133 bpm \(zone 2, from max HR 190\)\./)
  })

  it('tells the model history is sparse and starts at the training-day fallback', async () => {
    const sk = makeSkeleton({ goalDate: GOAL_DATE, baseline: 12 })
    generateObjectMock.mockResolvedValue({ object: validPlanFor(sk) })
    const { client, tables } = seed()
    const r = await generateTrainingPlan(client, USER, { goalDate: GOAL_DATE, now: NOW })
    const { prompt } = generateObjectMock.mock.calls[0][0] as { prompt: string }
    expect(prompt).toMatch(/HISTORY IS SPARSE/)
    expect(r.recap.baseline).toMatchObject({ weeklyKm: 12, source: 'fallback' })
    expect((tables.training_plans[0].recap as { sparse: boolean }).sparse).toBe(true)
  })
})

describe('athlete constraints in the workflow', () => {
  const HISTORY = {
    activities: ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'].flatMap((monday) =>
      ['T07:00:00Z', 'T17:00:00Z'].map((t) => ({
        user_id: USER, sport_type: 'run', started_at: `${monday}${t}`, distance_m: 15000, duration_s: 5400,
      }))
    ),
  }
  // Wednesday is unavailable: training days become monday, friday, saturday.
  const constraints = { unavailableWeekdays: ['wednesday'], notes: '1 leisure session per week' }
  const constrainedSkeleton = () =>
    buildSkeleton({ today: '2026-10-12', goalDate: GOAL_DATE, trainingDays: ['monday', 'friday', 'saturday'], baselineWeeklyKm: 30 })

  beforeEach(() => {
    generateObjectMock.mockReset()
  })

  it('removes the unavailable day from the slots, puts the notes in the prompt, and stores the constraints', async () => {
    generateObjectMock.mockResolvedValue({ object: validPlanFor(constrainedSkeleton()) })
    const { client, tables } = seed(HISTORY)
    await generateTrainingPlan(client, USER, { goalDate: GOAL_DATE, now: NOW, constraints })
    const { prompt, system } = generateObjectMock.mock.calls[0][0] as { prompt: string; system: string }
    expect(prompt).toMatch(/=== ATHLETE CONSTRAINTS ===/)
    expect(prompt).toContain('1 leisure session per week')
    expect(prompt).toMatch(/Unavailable weekdays[^\n]*wednesday/)
    expect(system).toMatch(/ATHLETE CONSTRAINTS/)
    const weeks = JSON.parse(prompt.split('Weekly skeleton (JSON):\n')[1].split('\n')[0]) as { slotDates: string[] }[]
    const wednesdays = weeks.flatMap((w) => w.slotDates).filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 3)
    expect(wednesdays).toEqual([])
    expect(tables.planned_sessions.some((s) => new Date(`${s.scheduled_date}T00:00:00Z`).getUTCDay() === 3)).toBe(false)
    expect(tables.training_plans[0].constraints).toEqual(constraints)
  })

  it('rejects (and writes nothing) when the model still schedules on the unavailable day', async () => {
    // A plan built for the UNconstrained 4-day skeleton contains Wednesday sessions.
    generateObjectMock.mockResolvedValue({ object: validPlanFor(makeSkeleton({ goalDate: GOAL_DATE, baseline: 30 })) })
    const { client, tables } = seed(HISTORY)
    const err = await generateTrainingPlan(client, USER, { goalDate: GOAL_DATE, now: NOW, constraints }).catch((e) => e)
    expect(err.code).toBe('INVALID_PLAN')
    expect(err.issues.join(' ')).toMatch(/not one of the athlete's training days/)
    expect(tables.training_plans).toHaveLength(0)
    expect(tables.planned_sessions).toHaveLength(0)
  })

  it('fails with CONSTRAINTS_INVALID, before calling the model, when no training day is left', async () => {
    const { client, tables } = seed()
    const all = { unavailableWeekdays: ['monday', 'wednesday', 'friday', 'saturday'], notes: null }
    await expect(
      generateTrainingPlan(client, USER, { goalDate: GOAL_DATE, now: NOW, constraints: all })
    ).rejects.toMatchObject({ code: 'CONSTRAINTS_INVALID' })
    expect(generateObjectMock).not.toHaveBeenCalled()
    expect(tables.training_plans).toHaveLength(0)
  })

  it('omits the constraints block and column when none are given', async () => {
    generateObjectMock.mockResolvedValue({ object: validPlanFor(makeSkeleton({ goalDate: GOAL_DATE, baseline: 12 })) })
    const { client, tables } = seed()
    await generateTrainingPlan(client, USER, { goalDate: GOAL_DATE, now: NOW })
    const { prompt } = generateObjectMock.mock.calls[0][0] as { prompt: string }
    expect(prompt).not.toMatch(/ATHLETE CONSTRAINTS ===/)
    expect('constraints' in tables.training_plans[0]).toBe(false)
  })
})
