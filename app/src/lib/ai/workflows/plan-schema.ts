import { z } from 'zod'
import type { Database } from '@/types/database'

/**
 * Zod schemas that drive `generateObject` for plan generation, plus the mapper
 * to `planned_sessions` insert rows. Maps 1:1 to the migration-004 columns.
 */
export const plannedSessionSchema = z.object({
  scheduledDate: z.string().describe('ISO date YYYY-MM-DD, one of the listed slot dates'),
  sportType: z.enum(['run', 'football', 'gym', 'cycle', 'other']),
  sessionType: z.string().describe("e.g. 'easy', 'tempo', 'long run', 'intervals', 'recovery'"),
  description: z.string().describe('One or two sentences: what to do and why'),
  targetDistanceM: z.number().nullable().describe('Metres; null if not distance-based'),
  targetDurationS: z.number().nullable().describe('Seconds; null if not time-based'),
  targetHrZone: z.number().int().min(1).max(5).nullable(),
})

export const planSchema = z.object({
  title: z.string(),
  goal: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  sessions: z.array(plannedSessionSchema).min(1).max(400),
})

export type PlannedSessionDraft = z.infer<typeof plannedSessionSchema>
export type PlanDraft = z.infer<typeof planSchema>

type PlannedSessionInsert = Database['public']['Tables']['planned_sessions']['Insert']

const positiveInt = (n: number | null): number | null =>
  typeof n === 'number' && Number.isFinite(n) && Math.round(n) > 0 ? Math.round(n) : null

/** camelCase draft → snake_case `planned_sessions` insert rows (all `pending`). */
export function planToRows(plan: PlanDraft, userId: string, planId: string): PlannedSessionInsert[] {
  return plan.sessions.map((s) => ({
    plan_id: planId,
    user_id: userId,
    scheduled_date: s.scheduledDate,
    sport_type: s.sportType,
    session_type: s.sessionType.trim() || null,
    description: s.description.trim() || null,
    target_distance_m: positiveInt(s.targetDistanceM),
    target_duration_s: positiveInt(s.targetDurationS),
    target_hr_zone:
      s.targetHrZone != null && s.targetHrZone >= 1 && s.targetHrZone <= 5
        ? Math.round(s.targetHrZone)
        : null,
    status: 'pending' as const,
  }))
}
