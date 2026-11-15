import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { isIsoDate } from './dates'
import { applyFutureAndPending, isFutureAndPending } from './session-guard'

/** Loose, model-facing adjustment (see gotcha #36): everything nullable, validated here. */
export interface SessionAdjustment {
  sessionId: string
  scheduledDate?: string | null
  sessionType?: string | null
  description?: string | null
  targetDistanceM?: number | null
  targetDurationS?: number | null
  targetHrZone?: number | null
  reason?: string | null
}

export interface AdjustOutcome {
  adjusted: { sessionId: string; scheduledDate: string }[]
  rejected: { sessionId: string; reason: string }[]
}

export const MAX_ADJUSTMENTS_PER_CALL = 20
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const finitePositive = (n: unknown, max: number): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), max) : null

/**
 * Edit FUTURE `pending` sessions only (spec Req 3.3), through the same guard the
 * manual reschedule uses. Never throws for a bad item: it is reported in `rejected`.
 */
export async function adjustUpcomingSessions(
  supabase: SupabaseClient<Database>,
  userId: string,
  adjustments: SessionAdjustment[],
  today: string
): Promise<AdjustOutcome> {
  const outcome: AdjustOutcome = { adjusted: [], rejected: [] }

  for (const adj of adjustments.slice(0, MAX_ADJUSTMENTS_PER_CALL)) {
    const id = adj?.sessionId
    const reject = (reason: string) => outcome.rejected.push({ sessionId: String(id), reason })
    if (typeof id !== 'string' || !UUID.test(id)) {
      reject('Not a valid session id. Call getPlannedSessions and use the exact "id".')
      continue
    }

    const { data: session } = await supabase
      .from('planned_sessions')
      .select('id, plan_id, scheduled_date, status, ai_notes')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle()
    if (!session) {
      reject('Session not found.')
      continue
    }
    if (!isFutureAndPending(session, today)) {
      reject('Only upcoming pending sessions can be changed (this one is past, completed, skipped or already modified).')
      continue
    }

    const update: Database['public']['Tables']['planned_sessions']['Update'] = {}
    if (adj.scheduledDate != null) {
      if (!isIsoDate(adj.scheduledDate) || adj.scheduledDate < today) {
        reject('New date must be a valid YYYY-MM-DD date that is today or later.')
        continue
      }
      const { data: plan } = await supabase
        .from('training_plans')
        .select('start_date, end_date')
        .eq('id', session.plan_id)
        .eq('user_id', userId)
        .maybeSingle()
      if (plan && (adj.scheduledDate < plan.start_date || adj.scheduledDate > plan.end_date)) {
        reject(`New date must be inside the plan (${plan.start_date} to ${plan.end_date}).`)
        continue
      }
      update.scheduled_date = adj.scheduledDate
    }
    if (typeof adj.sessionType === 'string' && adj.sessionType.trim()) {
      update.session_type = adj.sessionType.trim().slice(0, 60)
    }
    if (typeof adj.description === 'string' && adj.description.trim()) {
      update.description = adj.description.trim().slice(0, 500)
    }
    const dist = finitePositive(adj.targetDistanceM, 250_000)
    if (dist != null) update.target_distance_m = dist
    const dur = finitePositive(adj.targetDurationS, 86_400)
    if (dur != null) update.target_duration_s = dur
    if (typeof adj.targetHrZone === 'number' && Number.isFinite(adj.targetHrZone)) {
      const z = Math.round(adj.targetHrZone)
      if (z >= 1 && z <= 5) update.target_hr_zone = z
    }
    if (!Object.keys(update).length) {
      reject('Nothing valid to change.')
      continue
    }
    if (typeof adj.reason === 'string' && adj.reason.trim()) {
      update.ai_notes = `Adjusted by coach: ${adj.reason.trim().slice(0, 300)}`
    }

    const { data: updated, error } = await applyFutureAndPending(
      supabase.from('planned_sessions').update(update).eq('id', id).eq('user_id', userId),
      today
    )
      .select('id, scheduled_date')
      .maybeSingle()
    if (error || !updated) {
      reject('The session changed and could not be updated.')
      continue
    }
    outcome.adjusted.push({ sessionId: id, scheduledDate: updated.scheduled_date })
  }

  for (const extra of adjustments.slice(MAX_ADJUSTMENTS_PER_CALL)) {
    outcome.rejected.push({
      sessionId: String(extra?.sessionId),
      reason: `Too many changes in one call (max ${MAX_ADJUSTMENTS_PER_CALL}).`,
    })
  }
  return outcome
}
