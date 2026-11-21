import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { dayBoundsEpoch, isIsoDate, localDateInTz } from './dates'
import { bucketActivities, type PlanActivity, type RawActivity } from './day-items'
import { ACTIVITY_COLUMNS } from './load-plan'
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
  | { ok: true; date: string; strava: StravaSyncStatus; imported: number; activities: PlanActivity[] }
  | { ok: false; status: 400; error: string }

/**
 * Per-day "Sync" on the plan calendar. Imports that athlete-local day's Strava
 * activities when Strava is connected (idempotent: dedup by external_id), then
 * returns the day's saved activities. Strava problems never fail the call; they
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
        withStreams: false,
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

  const [startSec, endSec] = dayBoundsEpoch(date, tz)
  const { data: acts } = await supabase
    .from('activities')
    .select(ACTIVITY_COLUMNS)
    .eq('user_id', userId)
    .gte('started_at', new Date(startSec * 1000).toISOString())
    .lte('started_at', new Date(endSec * 1000).toISOString())
    .order('started_at', { ascending: true })
    .limit(100)
  const { data: linkedRows } = await supabase
    .from('planned_sessions')
    .select('completed_activity_id')
    .eq('user_id', userId)
  const linked = ((linkedRows ?? []) as { completed_activity_id: string | null }[])
    .map((r) => r.completed_activity_id)
    .filter((id): id is string => !!id)

  return {
    ok: true,
    date,
    strava,
    imported,
    activities: bucketActivities((acts ?? []) as RawActivity[], tz, linked, { from: date, to: date }),
  }
}
