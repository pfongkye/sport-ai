import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { haversineM } from '@/lib/importers/helpers'

interface StreamPoint {
  t: number // seconds from start
  v: number | [number, number]
}

/**
 * Build a cumulative distance-vs-time array for an activity from its streams.
 *
 * Prefers GPS (latlng) since it's the ground truth for distance; falls back to
 * integrating the pace stream (s/km → speed) when GPS is absent (treadmill).
 * Returns [{ t: seconds, d: cumulative_meters }] sorted by time.
 */
function buildDistanceTime(streams: Record<string, StreamPoint[]>): { t: number; d: number }[] {
  const latlng = streams['latlng']
  if (latlng && latlng.length > 1) {
    const out: { t: number; d: number }[] = []
    let cum = 0
    let prev: [number, number] | null = null
    for (const p of latlng) {
      const v = p.v as [number, number]
      if (prev) cum += haversineM(prev, v)
      prev = v
      out.push({ t: p.t, d: cum })
    }
    return out
  }

  // Fallback: integrate pace (s per km) into distance.
  const pace = streams['pace']
  if (pace && pace.length > 1) {
    const out: { t: number; d: number }[] = []
    let cum = 0
    for (let i = 0; i < pace.length; i++) {
      const secPerKm = pace[i].v as number
      const dt = i > 0 ? pace[i].t - pace[i - 1].t : 0
      // speed m/s = 1000 / secPerKm ; distance = speed * dt
      if (secPerKm > 0 && dt > 0) cum += (1000 / secPerKm) * dt
      out.push({ t: pace[i].t, d: cum })
    }
    return out
  }

  return []
}

/**
 * Fastest time (seconds) to cover `windowM` meters anywhere in the activity,
 * using a two-pointer sweep over the cumulative distance-time series.
 * Returns null if the activity is shorter than the window.
 */
function fastestWindow(dt: { t: number; d: number }[], windowM: number): number | null {
  if (dt.length < 2) return null
  const total = dt[dt.length - 1].d
  if (total < windowM) return null

  let best = Infinity
  let lo = 0
  for (let hi = 0; hi < dt.length; hi++) {
    // advance lo until the covered distance is >= windowM
    while (dt[hi].d - dt[lo].d >= windowM) {
      const elapsed = dt[hi].t - dt[lo].t
      if (elapsed > 0 && elapsed < best) best = elapsed
      lo++
    }
  }
  return best === Infinity ? null : Math.round(best)
}

export interface BestSplits {
  activityId: string
  startedAt: string
  distanceM: number | null
  /** Fastest split times in seconds, keyed by distance. null = activity too short. */
  best: {
    '400m': number | null
    '1km': number | null
    '1mile': number | null
    '5km': number | null
    '10km': number | null
  }
}

/**
 * Compute best-effort splits for the athlete's recent runs.
 * Reads the pace/latlng streams and finds the fastest rolling window for each
 * standard distance. This is the ground-truth source for "fastest 1km" type
 * questions — the LLM must use this, never estimate from averages.
 */
export async function computeBestSplits(
  supabase: SupabaseClient<Database>,
  userId: string,
  opts: { limit?: number; activityId?: string } = {}
): Promise<BestSplits[]> {
  const limit = Math.min(opts.limit ?? 5, 20)

  let actQuery = supabase
    .from('activities')
    .select('id, started_at, distance_m')
    .eq('user_id', userId)
    .eq('sport_type', 'run')
    .order('started_at', { ascending: false })
    .limit(limit)
  if (opts.activityId) actQuery = actQuery.eq('id', opts.activityId)

  const { data: activities } = await actQuery
  if (!activities?.length) return []

  const results: BestSplits[] = []
  for (const a of activities) {
    const { data: streamRows } = await supabase
      .from('activity_streams')
      .select('stream_type, data')
      .eq('activity_id', a.id)
      .eq('user_id', userId)
      .in('stream_type', ['latlng', 'pace'])

    const streams: Record<string, StreamPoint[]> = {}
    for (const r of streamRows ?? []) {
      streams[r.stream_type] = r.data as unknown as StreamPoint[]
    }
    const dt = buildDistanceTime(streams)

    results.push({
      activityId: a.id,
      startedAt: a.started_at,
      distanceM: a.distance_m,
      best: {
        '400m': fastestWindow(dt, 400),
        '1km': fastestWindow(dt, 1000),
        '1mile': fastestWindow(dt, 1609.34),
        '5km': fastestWindow(dt, 5000),
        '10km': fastestWindow(dt, 10000),
      },
    })
  }
  return results
}
