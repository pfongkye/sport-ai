/**
 * Strava sync service — list recent Strava activities (flagging which are
 * already imported) and import selected (or all-new) ones into our activities
 * table, skipping duplicates.
 *
 * Shared by the API routes AND the coach tools so the natural-language path
 * ("import my last 3 Strava runs") and the button path behave identically.
 *
 * Reads a valid access token via the token manager (auto-refresh). Writes go
 * through the shared insertNormalizedActivity path (dedup by external_id).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  getActivity,
  getActivityStreams,
  listActivities,
  type StravaActivity,
} from './client'
import { getValidAccessToken, markSynced } from './tokens'
import {
  stravaToNormalized,
  stravaExternalId,
  type StravaActivitySummary,
} from '@/lib/importers/strava'
import { insertNormalizedActivity } from '@/lib/activities/insert-normalized'

/**
 * List the athlete's recent Strava activities and flag which already exist
 * locally (by external_id), so the UI/agent can show "new" vs "imported".
 */
export async function listStravaActivities(
  admin: SupabaseClient<Database>,
  userId: string,
  opts: { limit?: number; perPage?: number } = {}
): Promise<StravaActivitySummary[]> {
  const limit = Math.min(opts.limit ?? 30, 100)
  const accessToken = await getValidAccessToken(admin, userId)
  const activities = await listActivities(accessToken, {
    perPage: Math.min(opts.perPage ?? limit, 100),
    page: 1,
  })

  const sliced = activities.slice(0, limit)
  if (!sliced.length) return []

  // One query to find which of these external_ids already exist for the user.
  const externalIds = sliced.map((a) => stravaExternalId(a.id))
  const { data: existing } = await admin
    .from('activities')
    .select('external_id')
    .eq('user_id', userId)
    .in('external_id', externalIds)
  const existingSet = new Set((existing ?? []).map((r) => r.external_id as string))

  return sliced.map((a) => ({
    id: a.id,
    name: a.name,
    sportType: a.sport_type ?? a.type,
    startedAt: a.start_date,
    distanceM: a.distance ?? 0,
    durationS: a.moving_time ?? a.elapsed_time ?? 0,
    alreadyImported: existingSet.has(stravaExternalId(a.id)),
  }))
}

export interface ImportResult {
  imported: number
  skipped: number
  failed: number
  details: Array<{
    stravaId: number
    name: string
    status: 'created' | 'duplicate' | 'error'
    activityId?: string
    message?: string
  }>
}

/**
 * Import Strava activities into our table.
 * - If `activityIds` is given, import exactly those.
 * - Otherwise import the most recent `limit` activities (duplicates skipped).
 *
 * `withStreams` controls whether we fetch per-activity stream data (one extra
 * API call each — richer data, more rate-limit cost). Defaults to true.
 */
export async function importStravaActivities(
  admin: SupabaseClient<Database>,
  userId: string,
  opts: { activityIds?: number[]; limit?: number; withStreams?: boolean } = {}
): Promise<ImportResult> {
  const withStreams = opts.withStreams ?? true
  const accessToken = await getValidAccessToken(admin, userId)

  // Resolve the set of activities to import.
  let targets: StravaActivity[]
  if (opts.activityIds?.length) {
    // Fetch each requested activity in detail (also gives calories).
    targets = []
    for (const id of opts.activityIds) {
      try {
        targets.push(await getActivity(accessToken, id))
      } catch (err) {
        // Record as a failure below by inserting a stub; simpler: skip + note.
        targets.push({
          id,
          name: `Strava activity ${id}`,
          type: 'Workout',
          start_date: new Date().toISOString(),
          elapsed_time: 0,
          moving_time: 0,
          distance: 0,
          // mark unusable so the mapper produces a minimal row; the import will
          // still dedup/insert. We rethrow-safe by catching per item below.
          __fetchError: err instanceof Error ? err.message : 'fetch failed',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
      }
    }
  } else {
    const limit = Math.min(opts.limit ?? 10, 50)
    targets = await listActivities(accessToken, { perPage: limit, page: 1 })
    targets = targets.slice(0, limit)
  }

  const result: ImportResult = { imported: 0, skipped: 0, failed: 0, details: [] }

  for (const activity of targets) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchError = (activity as any).__fetchError as string | undefined
    if (fetchError) {
      result.failed++
      result.details.push({
        stravaId: activity.id,
        name: activity.name,
        status: 'error',
        message: fetchError,
      })
      continue
    }

    try {
      const streams = withStreams
        ? await getActivityStreams(accessToken, activity.id)
        : undefined
      const normalized = stravaToNormalized(activity, streams)
      const insertRes = await insertNormalizedActivity(admin, userId, normalized)

      if (insertRes.status === 'created') result.imported++
      else if (insertRes.status === 'duplicate') result.skipped++
      else result.failed++

      result.details.push({
        stravaId: activity.id,
        name: activity.name,
        status: insertRes.status,
        activityId: insertRes.activityId,
        message: insertRes.message,
      })
    } catch (err) {
      result.failed++
      result.details.push({
        stravaId: activity.id,
        name: activity.name,
        status: 'error',
        message: err instanceof Error ? err.message : 'Import failed',
      })
    }
  }

  await markSynced(admin, userId).catch(() => {})
  return result
}
