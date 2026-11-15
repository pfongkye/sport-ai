/**
 * The ONE editable-upcoming guardrail for planned sessions.
 *
 * A session may be changed by the manual reschedule endpoint, the coach's
 * `adjustUpcomingSessions` tool and the activity auto-link only when
 * `scheduled_date >= today` (today in the athlete's timezone), `status` is
 * 'pending' or 'modified' (a moved session stays editable) AND it has no
 * completed activity yet. Completed and skipped sessions are never editable.
 * Every path imports from here so they cannot diverge (spec Req 2a.2 / 3.3 / 3.4,
 * design careful-point #5).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { localDateInTz } from './dates'
import { resolveAthleteTimeZone } from './timezone'

export const EDITABLE_STATUSES = ['pending', 'modified'] as const

export interface GuardedSession {
  scheduled_date: string
  status: string
  completed_activity_id?: string | null
}

/** True when the session is today-or-later (athlete tz, via `today`), pending/modified and not completed. */
export function isEditableUpcoming(session: GuardedSession, today: string): boolean {
  return (
    (EDITABLE_STATUSES as readonly string[]).includes(session.status) &&
    session.scheduled_date >= today &&
    session.completed_activity_id == null
  )
}

/** Minimal builder shape: anything with chainable `gte`, `in` and `is` (supabase filter builders). */
interface FilterableQuery<Q> {
  gte(column: string, value: string): Q
  in(column: string, values: readonly string[]): Q
  is(column: string, value: null): Q
}

/**
 * Apply the same predicate as a SQL filter. Use it on every write so the guard
 * is enforced atomically in the statement, not only in a prior read.
 */
export function applyEditableUpcoming<Q extends FilterableQuery<Q>>(query: Q, today: string): Q {
  return query
    .gte('scheduled_date', today)
    .in('status', EDITABLE_STATUSES)
    .is('completed_activity_id', null)
}

/**
 * The athlete's timezone: the request's `tz` cookie (browser zone) when valid,
 * else `user_settings.timezone`, else UTC.
 */
export async function getAthleteTimezone(
  supabase: SupabaseClient<Database>,
  userId: string,
  cookieTz?: string | null
): Promise<string> {
  let settingsTz: string | null = null
  try {
    const { data } = await supabase
      .from('user_settings')
      .select('timezone')
      .eq('user_id', userId)
      .maybeSingle()
    settingsTz = data?.timezone ?? null
  } catch {
    // unreadable settings → cookie or UTC
  }
  return resolveAthleteTimeZone({ cookieTz, settingsTz })
}

/** "Today" as a `YYYY-MM-DD` date in the athlete's timezone. */
export async function getAthleteToday(
  supabase: SupabaseClient<Database>,
  userId: string,
  now: Date = new Date(),
  cookieTz?: string | null
): Promise<string> {
  return localDateInTz(now, await getAthleteTimezone(supabase, userId, cookieTz))
}
