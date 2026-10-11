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
    expect(
      schema!.safeParse!({ limit: 1, activityId: '550e8400-e29b-41d4-a716-446655440000' }).success
    ).toBe(true)
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
    expect(schema!.safeParse!({ sessionId: 'not-a-uuid', status: 'completed' }).success).toBe(true)
    // enum is still enforced
    expect(schema!.safeParse!({ sessionId: 'x', status: 'bogus' }).success).toBe(false)
  })
})
