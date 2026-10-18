import { describe, it, expect } from 'vitest'
import { computeBestSplits } from './splits'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Characterization tests for the "fastest segment" feature (the regression that
 * motivated the AI SDK upgrade). computeBestSplits reads activities + their
 * latlng/pace streams and finds the fastest rolling window per distance.
 *
 * We stub the Supabase client so the test is deterministic and offline.
 */

// Minimal chainable Supabase stub. `.from('activities')` resolves to the
// activities list; `.from('activity_streams')` resolves to that activity's
// streams. The query builder methods just return `this` until awaited.
function makeSupabase(opts: {
  activities: Array<{ id: string; started_at: string; distance_m: number | null }>
  streamsByActivity: Record<string, Array<{ stream_type: string; data: unknown }>>
}): SupabaseClient<Database> {
  const client = {
    from(table: string) {
      let activityIdFilter: string | null = null
      let gteFilter: string | null = null
      let lteFilter: string | null = null
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      builder.select = chain
      builder.eq = (col: string, val: string) => {
        if (table === 'activity_streams' && col === 'activity_id') activityIdFilter = val
        return builder
      }
      builder.order = chain
      builder.limit = chain
      builder.in = chain
      builder.gte = (_col: string, val: string) => {
        gteFilter = val
        return builder
      }
      builder.lte = (_col: string, val: string) => {
        lteFilter = val
        return builder
      }
      // Make the builder awaitable (thenable) so `await query` resolves data.
      builder.then = (resolve: (v: { data: unknown }) => void) => {
        if (table === 'activities') {
          let rows = opts.activities
          if (gteFilter && lteFilter) {
            const lo = gteFilter
            const hi = lteFilter
            rows = rows.filter((a) => a.started_at >= lo && a.started_at <= hi)
          }
          resolve({ data: rows })
        } else {
          resolve({ data: activityIdFilter ? opts.streamsByActivity[activityIdFilter] ?? [] : [] })
        }
      }
      return builder
    },
  }
  return client as unknown as SupabaseClient<Database>
}

/** Build a constant-pace latlng stream heading due north from (0,0). */
function straightLineLatLng(totalMeters: number, paceSecPerKm: number) {
  // 1 degree latitude ≈ 111_320 m. Step every ~10 m.
  const stepM = 10
  const n = Math.floor(totalMeters / stepM)
  const secPerM = paceSecPerKm / 1000
  const arr: { t: number; v: [number, number] }[] = []
  for (let i = 0; i <= n; i++) {
    const meters = i * stepM
    const lat = meters / 111_320
    arr.push({ t: Math.round(meters * secPerM), v: [lat, 0] })
  }
  return arr
}

describe('computeBestSplits', () => {
  it('returns [] when the athlete has no runs', async () => {
    const supabase = makeSupabase({ activities: [], streamsByActivity: {} })
    const res = await computeBestSplits(supabase, 'user-1', { limit: 5 })
    expect(res).toEqual([])
  })

  it('computes a 1km split from a GPS stream and leaves longer distances null', async () => {
    // 2 km at 5:00/km (300 s/km). 1km should be ~300s; 5km/10km null (too short).
    const latlng = straightLineLatLng(2000, 300)
    const supabase = makeSupabase({
      activities: [{ id: 'a1', started_at: '2026-01-01T00:00:00Z', distance_m: 2000 }],
      streamsByActivity: { a1: [{ stream_type: 'latlng', data: latlng }] },
    })

    const res = await computeBestSplits(supabase, 'user-1', { limit: 5 })
    expect(res).toHaveLength(1)
    const best = res[0].best

    // 1km at 300 s/km → ~300s. Allow a small tolerance for the 10 m stepping.
    expect(best['1km']).not.toBeNull()
    expect(best['1km']!).toBeGreaterThanOrEqual(295)
    expect(best['1km']!).toBeLessThanOrEqual(305)

    // 400m present and proportional (~120s).
    expect(best['400m']).not.toBeNull()
    expect(best['400m']!).toBeGreaterThanOrEqual(115)
    expect(best['400m']!).toBeLessThanOrEqual(125)

    // Activity shorter than these → null.
    expect(best['5km']).toBeNull()
    expect(best['10km']).toBeNull()
  })

  it('falls back to the pace stream when GPS (latlng) is absent (treadmill)', async () => {
    // Pace stream: constant 240 s/km for 1200 m worth of samples (every 10s).
    const pace: { t: number; v: number }[] = []
    // speed at 240 s/km = 1000/240 ≈ 4.1667 m/s → 10s steps = ~41.67 m each.
    let meters = 0
    let t = 0
    while (meters < 1200) {
      pace.push({ t, v: 240 })
      t += 10
      meters += (1000 / 240) * 10
    }
    const supabase = makeSupabase({
      activities: [{ id: 'a2', started_at: '2026-01-02T00:00:00Z', distance_m: 1200 }],
      streamsByActivity: { a2: [{ stream_type: 'pace', data: pace }] },
    })

    const res = await computeBestSplits(supabase, 'user-1', { limit: 5 })
    expect(res).toHaveLength(1)
    // 1km at 240 s/km → ~240s (tolerance for 10s stepping).
    expect(res[0].best['1km']).not.toBeNull()
    expect(res[0].best['1km']!).toBeGreaterThanOrEqual(235)
    expect(res[0].best['1km']!).toBeLessThanOrEqual(255)
  })

  it('returns all-null splits when an activity has no usable streams', async () => {
    const supabase = makeSupabase({
      activities: [{ id: 'a3', started_at: '2026-01-03T00:00:00Z', distance_m: 5000 }],
      streamsByActivity: { a3: [] },
    })
    const res = await computeBestSplits(supabase, 'user-1', { limit: 5 })
    expect(res).toHaveLength(1)
    expect(res[0].best['1km']).toBeNull()
    expect(res[0].best['400m']).toBeNull()
  })

  it('filters to a specific date when `date` is given (past run, not the latest)', async () => {
    // Three runs on different days; ask for the MIDDLE one by date.
    const mk = (id: string, day: string) => ({
      id,
      started_at: `${day}T07:00:00Z`,
      distance_m: 2000,
    })
    const latlng = straightLineLatLng(2000, 300)
    const supabase = makeSupabase({
      activities: [mk('new', '2026-03-10'), mk('mid', '2026-03-05'), mk('old', '2026-03-01')],
      streamsByActivity: {
        new: [{ stream_type: 'latlng', data: latlng }],
        mid: [{ stream_type: 'latlng', data: latlng }],
        old: [{ stream_type: 'latlng', data: latlng }],
      },
    })

    const res = await computeBestSplits(supabase, 'user-1', { date: '2026-03-05' })
    expect(res).toHaveLength(1)
    expect(res[0].activityId).toBe('mid')
    expect(res[0].best['1km']).not.toBeNull()
  })

  it('returns [] for a date with no run', async () => {
    const supabase = makeSupabase({
      activities: [{ id: 'a1', started_at: '2026-03-10T07:00:00Z', distance_m: 2000 }],
      streamsByActivity: { a1: [{ stream_type: 'latlng', data: straightLineLatLng(2000, 300) }] },
    })
    const res = await computeBestSplits(supabase, 'user-1', { date: '2026-03-05' })
    expect(res).toEqual([])
  })
})
