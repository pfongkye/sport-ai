/**
 * Strava → NormalizedActivity importer.
 *
 * Mirrors the file importers (fit/gpx/tcx): produces the same NormalizedActivity
 * shape so the shared insert path and dedup logic apply unchanged. The dedup id
 * is deterministic — `external_id = strava_<activity.id>` — and backed by the
 * activities UNIQUE (user_id, external_id) constraint, so re-importing the same
 * Strava activity is a no-op skip.
 */

import type { NormalizedActivity, NormalizedStream, StreamPoint } from '@/types/activity'
import type { StravaActivity, StravaStreamSet } from '@/lib/integrations/strava/client'
import { computeTrainingLoad, elevationGain, normalizeSport } from './helpers'

/** Deterministic dedup id for a Strava activity. */
export function stravaExternalId(activityId: number | string): string {
  return `strava_${activityId}`
}

/** Convert m/s speed to pace in s/km (0 speed → undefined to avoid div/0). */
function speedToPaceSPerKm(speedMs?: number): number | undefined {
  if (!speedMs || speedMs <= 0) return undefined
  return Math.round(1000 / speedMs)
}

/**
 * Build NormalizedStream[] from a Strava key_by_type stream set.
 * Strava streams are parallel arrays aligned to the `time` stream (seconds from
 * start). We zip each into our { t, v } StreamPoint form.
 */
function buildStreams(streams: StravaStreamSet): NormalizedStream[] {
  const time = streams.time?.data
  if (!time || !time.length) return []

  const out: NormalizedStream[] = []
  const zip = (data: Array<number | null> | undefined, map?: (v: number) => number): StreamPoint[] | null => {
    if (!data || !data.length) return null
    const pts: StreamPoint[] = []
    for (let i = 0; i < Math.min(time.length, data.length); i++) {
      const v = data[i]
      if (v == null) continue
      pts.push({ t: time[i], v: map ? map(v) : v })
    }
    return pts.length ? pts : null
  }

  if (streams.latlng?.data?.length) {
    const pts: StreamPoint[] = []
    for (let i = 0; i < Math.min(time.length, streams.latlng.data.length); i++) {
      const ll = streams.latlng.data[i]
      if (!ll) continue
      pts.push({ t: time[i], v: [ll[0], ll[1]] })
    }
    if (pts.length) out.push({ type: 'latlng', data: pts })
  }

  const hr = zip(streams.heartrate?.data)
  if (hr) out.push({ type: 'heartrate', data: hr })

  const cad = zip(streams.cadence?.data)
  if (cad) out.push({ type: 'cadence', data: cad })

  const alt = zip(streams.altitude?.data)
  if (alt) out.push({ type: 'altitude', data: alt })

  const power = zip(streams.watts?.data)
  if (power) out.push({ type: 'power', data: power })

  // Derive pace from smoothed velocity (m/s → s/km); skip zero-speed samples.
  const vel = streams.velocity_smooth?.data
  if (vel && vel.length) {
    const pace: StreamPoint[] = []
    for (let i = 0; i < Math.min(time.length, vel.length); i++) {
      const v = vel[i]
      if (v == null || v <= 0) continue
      pace.push({ t: time[i], v: Math.round(1000 / v) })
    }
    if (pace.length) out.push({ type: 'pace', data: pace })
  }

  return out
}

/**
 * Map a Strava activity (+ optional detailed streams) to a NormalizedActivity.
 * Summary metrics come from the activity; streams add time-series when present.
 */
export function stravaToNormalized(
  activity: StravaActivity,
  streams?: StravaStreamSet
): NormalizedActivity {
  const sportType = normalizeSport(activity.sport_type ?? activity.type)
  const startedAt = new Date(activity.start_date)
  // Prefer moving_time for load/pace realism; fall back to elapsed.
  const durationS = activity.moving_time || activity.elapsed_time || undefined
  const distanceM = activity.distance > 0 ? +activity.distance.toFixed(1) : undefined
  const avgHrBpm = activity.average_heartrate ? Math.round(activity.average_heartrate) : undefined
  const maxHrBpm = activity.max_heartrate ? Math.round(activity.max_heartrate) : undefined

  const avgPaceSPerKm =
    distanceM && durationS
      ? Math.round((durationS / distanceM) * 1000)
      : speedToPaceSPerKm(activity.average_speed)

  const normalizedStreams = streams ? buildStreams(streams) : []

  // Elevation: prefer Strava's summary; else derive from an altitude stream.
  const altStream = normalizedStreams.find((s) => s.type === 'altitude')
  const elevationGainM =
    activity.total_elevation_gain != null
      ? +activity.total_elevation_gain.toFixed(1)
      : altStream
        ? elevationGain(altStream.data)
        : undefined

  return {
    source: 'strava',
    externalId: stravaExternalId(activity.id),
    sportType,
    startedAt,
    durationS,
    distanceM,
    elevationGainM,
    avgHrBpm,
    maxHrBpm,
    avgPaceSPerKm,
    avgCadenceRpm: activity.average_cadence ? Math.round(activity.average_cadence) : undefined,
    caloriesKcal: activity.calories ? Math.round(activity.calories) : undefined,
    trainingLoad: computeTrainingLoad({ durationS, avgHrBpm, maxHrBpm }),
    notes: activity.name || undefined,
    streams: normalizedStreams,
    rawData: {
      format: 'strava',
      stravaId: activity.id,
      stravaType: activity.sport_type ?? activity.type,
      manual: activity.manual ?? false,
      trainer: activity.trainer ?? false,
    },
  }
}

/** A lightweight summary for listing Strava activities in UI / NL confirmation. */
export interface StravaActivitySummary {
  id: number
  name: string
  sportType: string
  startedAt: string
  distanceM: number
  durationS: number
  /** True when this activity already exists locally (by external_id). */
  alreadyImported: boolean
}
