/**
 * The ONE future-and-pending guardrail for planned sessions.
 *
 * A session may be changed by the manual reschedule endpoint AND by the coach's
 * `adjustUpcomingSessions` tool only when `scheduled_date >= today` (today in the
 * athlete's timezone) AND `status = 'pending'`. Both paths import from here so
 * they cannot diverge (spec Req 2a.2 / 3.3, design careful-point #5).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { localDateInTz } from './dates'

export interface GuardedSession {
  scheduled_date: string
  status: string
}

/** True when the session is today-or-later (athlete tz, via `today`) and still pending. */
export function isFutureAndPending(session: GuardedSession, today: string): boolean {
  return session.status === 'pending' && session.scheduled_date >= today
}

/** Minimal builder shape: anything with chainable `gte` and `eq` (supabase filter builders). */
interface FilterableQuery<Q> {
  gte(column: string, value: string): Q
  eq(column: string, value: string): Q
}

/**
 * Apply the same predicate as a SQL filter. Use it on every write so the guard
 * is enforced atomically in the statement, not only in a prior read.
 */
export function applyFutureAndPending<Q extends FilterableQuery<Q>>(query: Q, today: string): Q {
  return query.gte('scheduled_date', today).eq('status', 'pending')
}

/** The athlete's timezone from user_settings (UTC when unset/unreadable). */
export async function getAthleteTimezone(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<string> {
  try {
    const { data } = await supabase
      .from('user_settings')
      .select('timezone')
      .eq('user_id', userId)
      .maybeSingle()
    return data?.timezone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** "Today" as a `YYYY-MM-DD` date in the athlete's timezone. */
export async function getAthleteToday(
  supabase: SupabaseClient<Database>,
  userId: string,
  now: Date = new Date()
): Promise<string> {
  return localDateInTz(now, await getAthleteTimezone(supabase, userId))
}
