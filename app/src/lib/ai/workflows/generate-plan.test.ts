import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeFakeSupabase } from '@/lib/plan/__fixtures__/fake-supabase'
import { makeSkeleton, validPlanFor } from './plan-fixtures'

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
})
