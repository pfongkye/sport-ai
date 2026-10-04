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
  STRAVA_ATHLETE_LIMIT,
  STRAVA_RATE_LIMITED,
  STRAVA_UNAUTHORIZED,
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
  /** True when the import stopped early because Strava's rate limit was hit. */
  rateLimited: boolean
  details: Array<{
    stravaId: number
    name: string
    status: 'created' | 'duplicate' | 'error'
    activityId?: string
    message?: string
  }>
}

/**
 * Hard cap on how many activities a single import call will process, to protect
 * the app-wide Strava quota (200 req/15 min, 2,000/day — shared by ALL users).
 * Each imported activity costs 1–2 requests (detail + optional streams); a cap
 * of 50 keeps one import well under a single 15-min window.
 */
const MAX_IMPORT_BATCH = 50

/** Small delay between per-activity requests to avoid bursting the window. */
const INTER_REQUEST_DELAY_MS = 120
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Import Strava activities into our table.
 * - If `activityIds` is given, import exactly those (capped at MAX_IMPORT_BATCH).
 * - Otherwise import the most recent `limit` activities (duplicates skipped).
 *
 * `withStreams` controls whether we fetch per-activity stream data (one extra
 * API call each — richer data, more rate-limit cost). Defaults to true.
 *
 * Rate-limit safety: requests run sequentially with a small delay, capped per
 * call. If Strava returns 429 mid-import we STOP immediately (don't keep
 * hammering an exhausted quota), mark the not-yet-processed items as skipped,
 * and set `result.rateLimited` so the caller can tell the user to retry later.
 * An athlete-limit / revoked-token error aborts the whole import (rethrown).
 */
export async function importStravaActivities(
  admin: SupabaseClient<Database>,
  userId: string,
  opts: { activityIds?: number[]; limit?: number; withStreams?: boolean } = {}
): Promise<ImportResult> {
  const withStreams = opts.withStreams ?? true
  const accessToken = await getValidAccessToken(admin, userId)

  // Resolve the set of activities to import. Detail fetches for explicit ids are
  // sequential + throttled; a 429 while resolving aborts early (handled below).
  let targets: StravaActivity[]
  if (opts.activityIds?.length) {
    const ids = opts.activityIds.slice(0, MAX_IMPORT_BATCH)
    targets = []
    for (const id of ids) {
      try {
        targets.push(await getActivity(accessToken, id))
        await sleep(INTER_REQUEST_DELAY_MS)
      } catch (err) {
        const emsg = err instanceof Error ? err.message : 'fetch failed'
        // Quota/auth errors are app-wide — stop resolving more and let the loop
        // below surface them rather than fetching the rest.
        if (emsg === STRAVA_RATE_LIMITED || emsg === STRAVA_UNAUTHORIZED || emsg === STRAVA_ATHLETE_LIMIT) {
          throw err
        }
        targets.push({
          id,
          name: `Strava activity ${id}`,
          type: 'Workout',
          start_date: new Date().toISOString(),
          elapsed_time: 0,
          moving_time: 0,
          distance: 0,
          __fetchError: emsg,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
      }
    }
  } else {
    const limit = Math.min(opts.limit ?? 10, MAX_IMPORT_BATCH)
    targets = await listActivities(accessToken, { perPage: limit, page: 1 })
    targets = targets.slice(0, limit)
  }

  const result: ImportResult = { imported: 0, skipped: 0, failed: 0, rateLimited: false, details: [] }

  for (let i = 0; i < targets.length; i++) {
    const activity = targets[i]
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

      if (withStreams) await sleep(INTER_REQUEST_DELAY_MS)
    } catch (err) {
      const emsg = err instanceof Error ? err.message : 'Import failed'

      // Rate limited mid-import: stop now. Mark THIS item and all remaining ones
      // as skipped (not failed — they just weren't attempted) and flag it.
      if (emsg === STRAVA_RATE_LIMITED) {
        result.rateLimited = true
        for (let j = i; j < targets.length; j++) {
          result.skipped++
          result.details.push({
            stravaId: targets[j].id,
            name: targets[j].name,
            status: 'error',
            message: 'Skipped — Strava rate limit reached, try again later',
          })
        }
        break
      }

      // Revoked token / athlete-limit are app-wide — abort the whole import so
      // the route surfaces the right message instead of per-item noise.
      if (emsg === STRAVA_UNAUTHORIZED || emsg === STRAVA_ATHLETE_LIMIT) {
        await markSynced(admin, userId).catch(() => {})
        throw err
      }

      result.failed++
      result.details.push({
        stravaId: activity.id,
        name: activity.name,
        status: 'error',
        message: emsg,
      })
    }
  }

  await markSynced(admin, userId).catch(() => {})
  return result
}
