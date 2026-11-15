import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { isIsoDate } from './dates'
import { applyFutureAndPending, isFutureAndPending } from './session-guard'

export type RescheduleResult =
  | { ok: true; sessionId: string; from: string; to: string }
  | { ok: false; status: 400 | 404 | 409; error: string }

/**
 * Move ONE planned session to a new date. Server-side source of truth for
 * Req 2a: owner-scoped, future-and-pending only (shared guard, re-checked in
 * the UPDATE itself), new date must be today-or-later and inside the plan.
 * Writes only scheduled_date, status='modified' and an ai_notes trace.
 */
export async function rescheduleSession(
  supabase: SupabaseClient<Database>,
  userId: string,
  sessionId: string,
  newDate: unknown,
  today: string
): Promise<RescheduleResult> {
  if (!isIsoDate(newDate)) {
    return { ok: false, status: 400, error: 'date must be a valid YYYY-MM-DD date.' }
  }

  const { data: session } = await supabase
    .from('planned_sessions')
    .select('id, plan_id, scheduled_date, status, ai_notes')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!session) return { ok: false, status: 404, error: 'Session not found.' }

  if (!isFutureAndPending(session, today)) {
    return {
      ok: false,
      status: 409,
      error: 'Only upcoming sessions that are still pending can be moved.',
    }
  }
  if (newDate === session.scheduled_date) {
    return { ok: false, status: 400, error: 'Pick a different date.' }
  }
  if (newDate < today) {
    return { ok: false, status: 400, error: 'Sessions cannot be moved into the past.' }
  }

  const { data: plan } = await supabase
    .from('training_plans')
    .select('start_date, end_date')
    .eq('id', session.plan_id)
    .eq('user_id', userId)
    .maybeSingle()
  if (plan && (newDate < plan.start_date || newDate > plan.end_date)) {
    return {
      ok: false,
      status: 400,
      error: `Pick a date inside the plan (${plan.start_date} to ${plan.end_date}).`,
    }
  }

  const trace = `Moved manually from ${session.scheduled_date} to ${newDate}.`
  const note = session.ai_notes ? `${session.ai_notes} | ${trace}` : trace

  // The guard is part of the statement so a concurrent change cannot slip past.
  const { data: updated, error } = await applyFutureAndPending(
    supabase
      .from('planned_sessions')
      .update({ scheduled_date: newDate, status: 'modified', ai_notes: note })
      .eq('id', sessionId)
      .eq('user_id', userId),
    today
  )
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, status: 409, error: 'Could not move the session.' }
  if (!updated) {
    return { ok: false, status: 409, error: 'The session changed and can no longer be moved.' }
  }
  return { ok: true, sessionId, from: session.scheduled_date, to: newDate }
}
