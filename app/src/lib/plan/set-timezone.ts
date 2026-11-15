import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { isValidTimeZone } from './timezone'

export type SetTimezoneResult =
  | { ok: true; timezone: string; changed: boolean }
  | { ok: false; status: 400 | 500; error: string }

/**
 * Persist the athlete's browser zone on their own `user_settings` row (RLS-scoped
 * client). Validates it as an IANA zone and skips the write when unchanged.
 */
export async function setAthleteTimezone(
  supabase: SupabaseClient<Database>,
  userId: string,
  timeZone: unknown
): Promise<SetTimezoneResult> {
  if (!isValidTimeZone(timeZone)) {
    return { ok: false, status: 400, error: 'timeZone must be a valid IANA time zone.' }
  }
  const { data: current } = await supabase
    .from('user_settings')
    .select('timezone')
    .eq('user_id', userId)
    .maybeSingle()
  if (current?.timezone === timeZone) return { ok: true, timezone: timeZone, changed: false }
  const { error } = await supabase
    .from('user_settings')
    .update({ timezone: timeZone })
    .eq('user_id', userId)
  if (error) return { ok: false, status: 500, error: 'Failed to save time zone.' }
  return { ok: true, timezone: timeZone, changed: true }
}
