import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeFakeSupabase } from '@/lib/plan/__fixtures__/fake-supabase'
import { makeSkeleton, planWithWeeklyKm, validPlanFor } from './plan-fixtures'

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
    const sk = makeSkeleton({ goalDate: GOAL_DATE, baseline: 0 })
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
    const sk = makeSkeleton({ goalDate: GOAL_DATE, baseline: 0 })
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
    const sk = makeSkeleton({ goalDate: GOAL_DATE, baseline: 0 })
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
    const sk = makeSkeleton({ goalDate: GOAL_DATE, baseline: 0 })
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
    const ACTS = { activities: [{ user_id: USER, sport_type: 'run', started_at: '2026-10-05T07:00:00Z', distance_m: 120000, duration_s: 36000 }] }
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
