import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/** Statuses a session can be deleted from. Completed sessions are training history and stay. */
export const DELETABLE_STATUSES = ['pending', 'modified', 'skipped'] as const

export interface DeletableSession {
  status: string
  completed_activity_id?: string | null
}

/** True for sessions with no completed activity. Past or missed sessions can be deleted too (cleanup). */
export function isDeletable(session: DeletableSession): boolean {
  return (
    (DELETABLE_STATUSES as readonly string[]).includes(session.status) &&
    session.completed_activity_id == null
  )
}

export type DeleteSessionResult =
  | { ok: true; sessionId: string; date: string }
  | { ok: false; status: 404 | 409; error: string }

/**
 * Delete ONE planned session owned by the caller.
 * Authorization is two layers: the explicit `user_id` filter here and the owner-scoped RLS
 * DELETE policy on planned_sessions (migration 004). Another user's id looks like "not found".
 * The completed guard is part of the DELETE statement, so a session completed concurrently
 * (e.g. by activity auto-link) cannot be removed.
 * Linked rows: suggested_routes.planned_session_id is ON DELETE SET NULL (route kept, unlinked);
 * the completed activity is not referenced FROM the activity, and completed sessions are refused anyway.
 */
export async function deleteSession(
  supabase: SupabaseClient<Database>,
  userId: string,
  sessionId: string
): Promise<DeleteSessionResult> {
  const { data: session } = await supabase
    .from('planned_sessions')
    .select('id, scheduled_date, status, completed_activity_id')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!session) return { ok: false, status: 404, error: 'Session not found.' }
  if (!isDeletable(session)) {
    return { ok: false, status: 409, error: 'Completed sessions are part of your history and cannot be deleted.' }
  }

  const { data: deleted, error } = await supabase
    .from('planned_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('user_id', userId)
    .in('status', DELETABLE_STATUSES)
    .is('completed_activity_id', null)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, status: 409, error: 'Could not delete the session.' }
  if (!deleted) {
    return { ok: false, status: 409, error: 'The session changed and can no longer be deleted.' }
  }
  return { ok: true, sessionId, date: session.scheduled_date }
}
