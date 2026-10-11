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
})
