import { describe, it, expect } from 'vitest'
import { buildCoachTools } from './index'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Wiring guard: buildCoachTools must expose all expected typed tools, each with
 * a matching Mastra tool `id`. This is a cheap canary for the AI SDK / Mastra
 * upgrade — if the `createTool` API changes shape, this breaks immediately
 * instead of silently dropping a tool the coach relies on.
 */

const stubSupabase = {} as unknown as SupabaseClient<Database>
const stubAdmin = {} as unknown as SupabaseClient<Database>

const EXPECTED_TOOLS = [
  'getRecentActivities',
  'getTrainingLoad',
  'getBestSplits',
  'getPlannedSessions',
  'getUserProfile',
  'updateSessionStatus',
  'addActivity',
  'listStravaActivities',
  'importFromStrava',
  'suggestRoute',
  'generatePlan',
  'adjustUpcomingSessions',
] as const

describe('buildCoachTools', () => {
  it('returns exactly the expected set of tools', () => {
    const tools = buildCoachTools(stubSupabase, 'user-1', stubAdmin)
    expect(Object.keys(tools).sort()).toEqual([...EXPECTED_TOOLS].sort())
  })

  it('each tool carries the matching Mastra id and an execute fn', () => {
    const tools = buildCoachTools(stubSupabase, 'user-1', stubAdmin) as Record<
      string,
      { id?: string; execute?: unknown }
    >
    for (const name of EXPECTED_TOOLS) {
      expect(tools[name], `missing tool ${name}`).toBeTruthy()
      expect(tools[name].id).toBe(name)
      expect(typeof tools[name].execute).toBe('function')
    }
  })

  it('still builds the Strava tools when no admin client is provided', () => {
    // Without admin, the Strava tools exist but will report "not available" at
    // run time — the wiring itself must not depend on admin being present.
    const tools = buildCoachTools(stubSupabase, 'user-1')
    expect(Object.keys(tools).sort()).toEqual([...EXPECTED_TOOLS].sort())
  })

  it('getBestSplits accepts a non-UUID activityId without rejecting the call (regression)', () => {
    // The model sometimes sends activityId:"latest" for "my most recent run".
    // A strict z.string().uuid() schema made AI SDK reject the whole tool call
    // (AI_InvalidToolArgumentsError) → the turn ended with empty text → the
    // "No response. Try again." bug. The schema must now accept any string.
    const tools = buildCoachTools(stubSupabase, 'user-1') as Record<
      string,
      { inputSchema?: { safeParse?: (v: unknown) => { success: boolean } } }
    >
    const schema = tools.getBestSplits.inputSchema
    expect(schema?.safeParse).toBeTypeOf('function')
    expect(schema!.safeParse!({ limit: 1, activityId: 'latest' }).success).toBe(true)
    expect(schema!.safeParse!({ limit: 1 }).success).toBe(true)
    expect(schema!.safeParse!({ date: '2026-10-06' }).success).toBe(true)
    expect(schema!.safeParse!({}).success).toBe(true)
    // The EXACT prod args that failed: date query with no activityId. Must pass
    // and the omitted activityId must default to null (not be "Required").
    const r = schema!.safeParse!({ limit: 1, date: '2026-10-10' }) as {
      success: boolean
      data?: { activityId: unknown }
    }
    expect(r.success).toBe(true)
    expect(r.data?.activityId).toBeNull()
    expect(schema!.safeParse!({ limit: 1, activityId: null, date: null }).success).toBe(true)
    expect(
      schema!.safeParse!({ limit: 1, activityId: '550e8400-e29b-41d4-a716-446655440000' }).success
    ).toBe(true)
  })

  it('suggestRoute schema safeParses the all-omitted model payload to all-null (gotcha #36)', () => {
    // Under strict function-calling an .optional() field is still "Required";
    // these fields must be .nullable().default(null) so omitting them → null,
    // never a validation failure that silently kills the turn.
    const tools = buildCoachTools(stubSupabase, 'user-1') as Record<
      string,
      { inputSchema?: { safeParse?: (v: unknown) => { success: boolean; data?: unknown } } }
    >
    const schema = tools.suggestRoute.inputSchema
    expect(schema?.safeParse).toBeTypeOf('function')
    const r = schema!.safeParse!({}) as {
      success: boolean
      data?: { distanceKm: unknown; terrain: unknown; place: unknown }
    }
    expect(r.success).toBe(true)
    expect(r.data?.distanceKm).toBeNull()
    expect(r.data?.terrain).toBeNull()
    expect(r.data?.place).toBeNull()
    // Explicit nulls also pass.
    expect(schema!.safeParse!({ distanceKm: null, terrain: null, place: null }).success).toBe(true)
    // Real values pass; enum is still enforced.
    expect(schema!.safeParse!({ distanceKm: 10, terrain: 'uphill', place: 'park' }).success).toBe(true)
    expect(schema!.safeParse!({ terrain: 'bogus' }).success).toBe(false)
  })

  it('suggestRoute.execute returns needsLocation (not a throw) when location is unresolved (gotcha #36)', async () => {
    // Offline + deterministic: a stub Supabase where every resolveStart lookup
    // (profile home, recent activities) returns no data → the service throws
    // NO_LOCATION → execute MUST catch it and return { needsLocation: true }.
    const emptyBuilder = () => {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      Object.assign(chain, {
        select: self,
        eq: self,
        order: self,
        limit: self,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: [], error: null }),
      })
      return chain
    }
    const offlineSupabase = {
      from: () => emptyBuilder(),
    } as unknown as SupabaseClient<Database>

    const tools = buildCoachTools(offlineSupabase, 'user-1') as unknown as Record<
      string,
      { execute: (input: unknown, ...rest: unknown[]) => Promise<{ needsLocation?: boolean; message?: string }> }
    >
    const result = await tools.suggestRoute.execute({
      distanceKm: null,
      terrain: null,
      place: null,
    })
    expect(result.needsLocation).toBe(true)
    expect(typeof result.message).toBe('string')
  })

  it('updateSessionStatus accepts a non-UUID sessionId at the schema level (regression)', () => {
    // Same trap as getBestSplits: a strict uuid() would reject the whole call and
    // kill the turn. The schema must accept any string; execute() validates and
    // returns a graceful error instead.
    const tools = buildCoachTools(stubSupabase, 'user-1') as Record<
      string,
      { inputSchema?: { safeParse?: (v: unknown) => { success: boolean } } }
    >
    const schema = tools.updateSessionStatus.inputSchema
    // No `notes` sent → must pass (notes nullable+default), not fail as "Required".
    expect(schema!.safeParse!({ sessionId: 'not-a-uuid', status: 'completed' }).success).toBe(true)
    expect(schema!.safeParse!({ sessionId: 'x', status: 'skipped', notes: null }).success).toBe(true)
    // enum is still enforced
    expect(schema!.safeParse!({ sessionId: 'x', status: 'bogus' }).success).toBe(false)
  })
  it('generatePlan schema accepts the all-omitted payload as nulls (gotcha #36)', () => {
    const tools = buildCoachTools(stubSupabase, 'user-1') as Record<
      string,
      { inputSchema?: { safeParse?: (v: unknown) => { success: boolean; data?: unknown } } }
    >
    const schema = tools.generatePlan.inputSchema!
    const r = schema.safeParse!({}) as {
      success: boolean
      data?: { confirmed: unknown; goal: unknown; goalDate: unknown }
    }
    expect(r.success).toBe(true)
    expect(r.data).toEqual({ confirmed: false, goal: null, goalDate: null })
    // A non-ISO date must not reject the call at the schema; execute() handles it.
    expect(schema.safeParse!({ confirmed: true, goal: 'marathon', goalDate: 'November' }).success).toBe(true)
  })

  it('generatePlan.execute returns a structured error for a bad goalDate (no throw)', async () => {
    const tools = buildCoachTools(stubSupabase, 'user-1') as unknown as Record<
      string,
      { execute: (input: unknown) => Promise<{ created: boolean; error?: string }> }
    >
    const r = await tools.generatePlan.execute({ confirmed: true, goal: null, goalDate: 'November' })
    expect(r.created).toBe(false)
    expect(r.error).toMatch(/YYYY-MM-DD/)
  })

  it('adjustUpcomingSessions schema accepts non-UUID ids and omitted optional fields (gotcha #36)', () => {
    const tools = buildCoachTools(stubSupabase, 'user-1') as Record<
      string,
      { inputSchema?: { safeParse?: (v: unknown) => { success: boolean; data?: unknown } } }
    >
    const schema = tools.adjustUpcomingSessions.inputSchema!
    const r = schema.safeParse!({ adjustments: [{ sessionId: 'latest' }] }) as {
      success: boolean
      data?: { adjustments: Record<string, unknown>[] }
    }
    expect(r.success).toBe(true)
    expect(r.data?.adjustments[0]).toEqual({
      sessionId: 'latest',
      scheduledDate: null,
      sessionType: null,
      description: null,
      targetDistanceM: null,
      targetDurationS: null,
      targetHrZone: null,
      reason: null,
    })
    expect(schema.safeParse!({}).success).toBe(true)
    // Out-of-range numbers are not schema errors (clamped/ignored in execute).
    expect(
      schema.safeParse!({ adjustments: [{ sessionId: 'x', targetHrZone: 9, targetDistanceM: -1 }] }).success
    ).toBe(true)
  })

  it('adjustUpcomingSessions.execute with no adjustments returns a message, not a throw', async () => {
    const tools = buildCoachTools(stubSupabase, 'user-1') as unknown as Record<
      string,
      { execute: (input: unknown) => Promise<{ adjusted: unknown[]; message?: string }> }
    >
    const r = await tools.adjustUpcomingSessions.execute({ adjustments: [] })
    expect(r.adjusted).toEqual([])
    expect(r.message).toBeTruthy()
  })
})
