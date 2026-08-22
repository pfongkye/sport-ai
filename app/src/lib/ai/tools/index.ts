import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Factory — builds all typed Mastra tools with a scoped Supabase client.
 * Called per-request so RLS applies to the authenticated user.
 */
export function buildCoachTools(supabase: SupabaseClient<Database>, userId: string) {
  // ─── getRecentActivities ──────────────────────────────────────────────────
  const getRecentActivities = createTool({
    id: 'getRecentActivities',
    description:
      'Fetch the most recent activities for the athlete. Returns key metrics for each. Use this for quick summaries like "how was my last run" or "show me recent workouts".',
    inputSchema: z.object({
      limit: z.number().min(1).max(20).default(5).describe('Number of activities to return'),
      sportType: z
        .enum(['run', 'football', 'gym', 'cycle', 'other'])
        .optional()
        .describe('Filter by sport type'),
    }),
    execute: async ({ context }) => {
      let query = supabase
        .from('activities')
        .select(
          'id, sport_type, started_at, duration_s, distance_m, avg_hr_bpm, avg_pace_s_per_km, training_load, rpe, notes'
        )
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(context.limit)

      if (context.sportType) {
        query = query.eq('sport_type', context.sportType)
      }

      const { data, error } = await query
      if (error) throw new Error(`Failed to fetch activities: ${error.message}`)
      return { activities: data ?? [] }
    },
  })

  // ─── getTrainingLoad ──────────────────────────────────────────────────────
  const getTrainingLoad = createTool({
    id: 'getTrainingLoad',
    description:
      'Calculate the athlete\'s current training load metrics: ATL (acute/fatigue), CTL (chronic/fitness), TSB (form). Use this to assess readiness before prescribing sessions.',
    inputSchema: z.object({}),
    execute: async () => {
      // Fetch last 42 days of activities
      const since = new Date()
      since.setDate(since.getDate() - 42)

      const { data, error } = await supabase
        .from('activities')
        .select('started_at, training_load, sport_type')
        .eq('user_id', userId)
        .gte('started_at', since.toISOString())
        .order('started_at', { ascending: true })

      if (error) throw new Error(`Failed to fetch training load: ${error.message}`)

      const activities = data ?? []

      // EWMA decay factors
      const ATL_DAYS = 7
      const CTL_DAYS = 42
      const atlDecay = 1 - Math.exp(-1 / ATL_DAYS)
      const ctlDecay = 1 - Math.exp(-1 / CTL_DAYS)

      let atl = 0
      let ctl = 0

      // Build daily load map
      const dailyLoad: Record<string, number> = {}
      for (const a of activities) {
        const day = a.started_at.slice(0, 10)
        dailyLoad[day] = (dailyLoad[day] ?? 0) + (a.training_load ?? 0)
      }

      // Walk day by day over last 42 days
      for (let i = 41; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const day = d.toISOString().slice(0, 10)
        const load = dailyLoad[day] ?? 0
        atl = atl + atlDecay * (load - atl)
        ctl = ctl + ctlDecay * (load - ctl)
      }

      const tsb = ctl - atl
      const score = Math.max(0, Math.min(100, Math.round(50 + tsb * 2)))
      const label =
        tsb > 15 ? 'Fresh' : tsb > 0 ? 'Optimal' : tsb > -20 ? 'Tired' : 'Very Fatigued'

      return { atl: +atl.toFixed(2), ctl: +ctl.toFixed(2), tsb: +tsb.toFixed(2), score, label }
    },
  })

  // ─── getPlannedSessions ───────────────────────────────────────────────────
  const getPlannedSessions = createTool({
    id: 'getPlannedSessions',
    description:
      "Fetch upcoming planned training sessions from the athlete's active plan. Use this to tell the athlete what's scheduled this week.",
    inputSchema: z.object({
      days: z
        .number()
        .min(1)
        .max(14)
        .default(7)
        .describe('How many days ahead to look'),
    }),
    execute: async ({ context }) => {
      const today = new Date().toISOString().slice(0, 10)
      const until = new Date()
      until.setDate(until.getDate() + context.days)

      const { data, error } = await supabase
        .from('planned_sessions')
        .select(
          'id, scheduled_date, sport_type, session_type, description, target_distance_m, target_duration_s, target_hr_zone, status, ai_notes'
        )
        .eq('user_id', userId)
        .gte('scheduled_date', today)
        .lte('scheduled_date', until.toISOString().slice(0, 10))
        .order('scheduled_date', { ascending: true })

      if (error) throw new Error(`Failed to fetch planned sessions: ${error.message}`)
      return { sessions: data ?? [] }
    },
  })

  // ─── getUserProfile ───────────────────────────────────────────────────────
  const getUserProfile = createTool({
    id: 'getUserProfile',
    description:
      "Fetch the athlete's profile including goal, sports preferences, and training availability.",
    inputSchema: z.object({}),
    execute: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('display_name, date_of_birth, weight_kg, height_cm, sport_prefs, primary_goal, training_days')
        .eq('id', userId)
        .single()

      if (error) throw new Error(`Failed to fetch profile: ${error.message}`)
      return { profile: data }
    },
  })

  // ─── updateSessionStatus ──────────────────────────────────────────────────
  const updateSessionStatus = createTool({
    id: 'updateSessionStatus',
    description:
      "Update a planned session's status (completed, skipped, modified). Call this after the athlete confirms they completed or skipped a session.",
    inputSchema: z.object({
      sessionId: z.string().uuid().describe('The planned session ID'),
      status: z.enum(['completed', 'skipped', 'modified']),
      notes: z.string().optional().describe('Optional note about what happened'),
    }),
    execute: async ({ context }) => {
      const { error } = await supabase
        .from('planned_sessions')
        .update({ status: context.status, ai_notes: context.notes })
        .eq('id', context.sessionId)
        .eq('user_id', userId)

      if (error) throw new Error(`Failed to update session: ${error.message}`)
      return { success: true, sessionId: context.sessionId, status: context.status }
    },
  })

  return {
    getRecentActivities,
    getTrainingLoad,
    getPlannedSessions,
    getUserProfile,
    updateSessionStatus,
  }
}
