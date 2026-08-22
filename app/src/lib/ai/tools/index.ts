import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { computeReadiness } from '../readiness'

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
      "Calculate the athlete's readiness: ATL (acute/fatigue), CTL (chronic/fitness), TSB (form), and a 0-100 readiness score. Use this to assess readiness before prescribing sessions. If the athlete has little history the score defaults to fresh — say so rather than claiming fatigue.",
    inputSchema: z.object({}),
    execute: async () => {
      const readiness = await computeReadiness(supabase, userId)
      if (!readiness) {
        return {
          hasData: false,
          message:
            'No activities logged yet, so training load cannot be computed. Assume the athlete is fresh.',
        }
      }
      return { hasData: true, ...readiness }
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
