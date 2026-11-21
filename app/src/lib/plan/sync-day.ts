import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { dayBoundsEpoch, isIsoDate, localDateInTz } from './dates'
import { getConnection } from '@/lib/integrations/strava/tokens'
import { importStravaActivities } from '@/lib/integrations/strava/sync'
import { STRAVA_NOT_CONNECTED } from '@/lib/integrations/strava/errors'
import {
  STRAVA_ATHLETE_LIMIT,
  STRAVA_RATE_LIMITED,
  STRAVA_UNAUTHORIZED,
} from '@/lib/integrations/strava/client'

export type StravaSyncStatus =
  | 'synced'
  | 'not_connected'
  | 'rate_limited'
  | 'athlete_limit'
  | 'unauthorized'
  | 'error'

export type SyncDayResult =
  | { ok: true; date: string; strava: StravaSyncStatus; imported: number }
  | { ok: false; status: 400; error: string }

/**
 * Per-day "Sync" on the plan calendar. Imports that athlete-local day's Strava
 * activities when Strava is connected (idempotent: dedup by external_id), then
 * returns the outcome; the UI refreshes the page to show saved activities.
 * Streams are fetched (limit 10), since later imports skip existing activities. Strava problems never fail the call; they
 * come back as a `strava` status so the UI can say what happened.
 */
export async function syncPlanDay(
  supabase: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  userId: string,
  date: unknown,
  tz: string,
  now: Date = new Date()
): Promise<SyncDayResult> {
  if (!isIsoDate(date)) return { ok: false, status: 400, error: 'date must be YYYY-MM-DD' }
  if (date > localDateInTz(now, tz)) {
    return { ok: false, status: 400, error: 'Cannot sync a future day' }
  }

  let strava: StravaSyncStatus = 'not_connected'
  let imported = 0
  const connection = await getConnection(supabase, userId).catch(() => null)
  if (connection) {
    const [startSec, endSec] = dayBoundsEpoch(date, tz)
    try {
      const res = await importStravaActivities(admin, userId, {
        after: startSec - 1,
        before: endSec,
        limit: 10,
              })
      imported = res.imported
      strava = res.rateLimited ? 'rate_limited' : 'synced'
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      strava =
        msg === STRAVA_RATE_LIMITED
          ? 'rate_limited'
          : msg === STRAVA_ATHLETE_LIMIT
            ? 'athlete_limit'
            : msg === STRAVA_UNAUTHORIZED
              ? 'unauthorized'
              : msg === STRAVA_NOT_CONNECTED
                ? 'not_connected'
                : 'error'
    }
  }

  return { ok: true, date, strava, imported }
}
