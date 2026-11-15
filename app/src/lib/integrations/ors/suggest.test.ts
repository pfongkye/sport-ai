import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { resolveStart, suggestRoute, selectCandidate, nextRoundTripLength, NO_LOCATION } from './suggest'
import { ORS_NO_ROUTE } from './client'

/**
 * Offline tests for the ORS suggest service. Supabase is stubbed (chainable,
 * thenable builder like splits.test.ts) and global fetch is mocked so no network
 * is touched. ORS_API_KEY is set so the client's requireKey() passes.
 */

interface SupabaseStubOpts {
  profile?: { home_lat: number | null; home_lng: number | null; home_label: string | null } | null
  activities?: Array<{ id: string }>
  latlngByActivity?: Record<string, Array<{ t: number; v: [number, number] }>>
  /** Captures the row passed to suggested_routes.insert(). */
  onInsert?: (row: Record<string, unknown>) => void
  insertedId?: string
}

function makeSupabase(opts: SupabaseStubOpts): SupabaseClient<Database> {
  const client = {
    from(table: string) {
      let activityIdFilter: string | null = null
      let insertRow: Record<string, unknown> | null = null
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      builder.select = chain
      builder.order = chain
      builder.limit = chain
      builder.eq = (col: string, val: string) => {
        if (table === 'activity_streams' && col === 'activity_id') activityIdFilter = val
        return builder
      }
      builder.insert = (row: Record<string, unknown>) => {
        insertRow = row
        return builder
      }
      builder.maybeSingle = () => {
        if (table === 'profiles') return Promise.resolve({ data: opts.profile ?? null })
        return Promise.resolve({ data: null })
      }
      builder.single = () => {
        if (table === 'suggested_routes' && insertRow) {
          opts.onInsert?.(insertRow)
          return Promise.resolve({
            data: { id: opts.insertedId ?? 'route-1' },
            error: null,
          })
        }
        return Promise.resolve({ data: null, error: null })
      }
      // Awaitable for the list queries.
      builder.then = (resolve: (v: { data: unknown }) => void) => {
        if (table === 'activities') {
          resolve({ data: opts.activities ?? [] })
        } else if (table === 'activity_streams') {
          const rows = activityIdFilter
            ? [{ data: opts.latlngByActivity?.[activityIdFilter] ?? [] }]
            : []
          resolve({ data: rows })
        } else {
          resolve({ data: [] })
        }
      }
      return builder
    },
  }
  return client as unknown as SupabaseClient<Database>
}

/**
 * A fake ORS geo+json response with a real 3D geometry whose COMPUTED gain
 * (smoothed + hysteresis) equals `ascent`: a monotonic ramp up then down, one
 * point per ~100 m (so smoothing leaves it intact). `summaryAscent` is the (noisy)
 * ORS summary value and defaults to `ascent`.
 */
function orsResponse(ascent: number, distance = 5000, summaryAscent = ascent) {
  const legPoints = 25
  const stepDeg = 100 / (6371000 * (Math.PI / 180))
  const coordinates: number[][] = []
  for (let i = 0; i <= 2 * legPoints; i++) {
    const up = i <= legPoints ? i : 2 * legPoints - i
    coordinates.push([-0.1, 51.5 + i * stepDeg, 10 + (ascent * up) / legPoints])
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates },
          properties: { summary: { distance, ascent: summaryAscent, descent: summaryAscent } },
        },
      ],
    }),
    text: async () => '',
  }
}

beforeEach(() => {
  process.env.ORS_API_KEY = 'test-key'
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.ORS_API_KEY
})

describe('resolveStart priority chain', () => {
  it('uses an explicit coordinate first', async () => {
    const supabase = makeSupabase({})
    const start = await resolveStart(supabase, 'u1', {
      distanceKm: 5,
      terrain: 'flat',
      coord: { lng: 2, lat: 48 },
    })
    expect(start).toEqual({ lng: 2, lat: 48, label: null })
  })

  it('geocodes placeText when no explicit coord', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          features: [
            { geometry: { coordinates: [-0.16, 51.51] }, properties: { label: 'Hyde Park' } },
          ],
        }),
        text: async () => '',
      }))
    )
    const supabase = makeSupabase({})
    const start = await resolveStart(supabase, 'u1', {
      distanceKm: 5,
      terrain: 'flat',
      placeText: 'Hyde Park',
    })
    expect(start).toEqual({ lng: -0.16, lat: 51.51, label: 'Hyde Park' })
  })

  it('uses browserCoord before profile home', async () => {
    const supabase = makeSupabase({
      profile: { home_lat: 10, home_lng: 20, home_label: 'Home' },
    })
    const start = await resolveStart(supabase, 'u1', {
      distanceKm: 5,
      terrain: 'flat',
      browserCoord: { lng: 3, lat: 45 },
    })
    expect(start).toEqual({ lng: 3, lat: 45, label: null })
  })

  it('falls back to profile home location', async () => {
    const supabase = makeSupabase({
      profile: { home_lat: 51.5, home_lng: -0.12, home_label: 'Home' },
    })
    const start = await resolveStart(supabase, 'u1', { distanceKm: 5, terrain: 'flat' })
    expect(start).toEqual({ lng: -0.12, lat: 51.5, label: 'Home' })
  })

  it('falls back to the latest activity latlng first point (lat-first → lng-first)', async () => {
    const supabase = makeSupabase({
      profile: { home_lat: null, home_lng: null, home_label: null },
      activities: [{ id: 'a1' }],
      latlngByActivity: {
        // stored lat-first: [lat, lng]
        a1: [{ t: 0, v: [51.6, -0.2] }],
      },
    })
    const start = await resolveStart(supabase, 'u1', { distanceKm: 5, terrain: 'flat' })
    expect(start).toEqual({ lng: -0.2, lat: 51.6, label: 'Last run start' })
  })

  it('throws NO_LOCATION when nothing resolves', async () => {
    const supabase = makeSupabase({ profile: null, activities: [] })
    await expect(
      resolveStart(supabase, 'u1', { distanceKm: 5, terrain: 'flat' })
    ).rejects.toThrow(NO_LOCATION)
  })
})

describe('suggestRoute', () => {
  it('happy path: writes ONE normalised suggested_routes row and returns the result', async () => {
    const inserts: Record<string, unknown>[] = []
    // Three seeds → three ascents; flat should pick the smallest (10).
    const ascents = [50, 10, 90]
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => orsResponse(ascents[call++] ?? 10))
    )
    const supabase = makeSupabase({
      onInsert: (row) => inserts.push(row),
      insertedId: 'route-xyz',
    })

    const result = await suggestRoute(supabase, 'u1', {
      distanceKm: 5,
      terrain: 'flat',
      coord: { lng: -0.1, lat: 51.5 },
    })

    expect(inserts).toHaveLength(1)
    expect(result.routeId).toBe('route-xyz')
    expect(result.terrain).toBe('flat')
    expect(result.requestedDistanceM).toBe(5000)
    expect(result.distanceM).toBe(5000)
    // flat → min ascent of [50,10,90]
    expect(result.ascentM).toBe(10)
    expect(result.geometry.type).toBe('LineString')
    expect(result.elevationProfile.length).toBeGreaterThan(0)
    expect(result.bbox).toHaveLength(4)
    // Persisted row mirrors the result.
    expect(inserts[0].user_id).toBe('u1')
    expect(inserts[0].ascent_m).toBe(10)
    expect(inserts[0].terrain).toBe('flat')
  })

  it('uphill picks the MAX ascent candidate', async () => {
    const ascents = [50, 10, 90]
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => orsResponse(ascents[call++] ?? 10))
    )
    const supabase = makeSupabase({ insertedId: 'r2' })
    const result = await suggestRoute(supabase, 'u1', {
      distanceKm: 5,
      terrain: 'uphill',
      coord: { lng: -0.1, lat: 51.5 },
    })
    expect(result.ascentM).toBe(90)
  })

  it('uphill ignores a larger ORS summary.ascent when computed ascent is lower', async () => {
    // [computed, ORS summary]: first has the huge (noisy) ORS figure but little real climb.
    const candidates: Array<[number, number]> = [
      [20, 500],
      [60, 5],
      [30, 40],
    ]
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const [computed, summary] = candidates[call++] ?? candidates[0]
        return orsResponse(computed, 5000, summary)
      })
    )
    const inserts: Record<string, unknown>[] = []
    const supabase = makeSupabase({ onInsert: (row) => inserts.push(row), insertedId: 'r4' })
    const result = await suggestRoute(supabase, 'u1', {
      distanceKm: 5,
      terrain: 'uphill',
      coord: { lng: -0.1, lat: 51.5 },
    })
    expect(result.ascentM).toBe(60)
    expect(inserts[0].ascent_m).toBe(60)
  })

  it('chart profile comes from the same series: range ≤ computed ascent + 1', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => orsResponse(40)))
    const supabase = makeSupabase({ insertedId: 'r5' })
    const result = await suggestRoute(supabase, 'u1', {
      distanceKm: 5,
      terrain: 'flat',
      coord: { lng: -0.1, lat: 51.5 },
    })
    const ele = result.elevationProfile.map((p) => p.eleM)
    expect(Math.max(...ele) - Math.min(...ele)).toBeLessThanOrEqual(result.ascentM + 1)
  })

  it('sets planned_session_id when attaching to a session', async () => {
    const inserts: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async () => orsResponse(20)))
    const supabase = makeSupabase({ onInsert: (row) => inserts.push(row), insertedId: 'r3' })
    await suggestRoute(supabase, 'u1', {
      distanceKm: 8,
      terrain: 'flat',
      coord: { lng: -0.1, lat: 51.5 },
      plannedSessionId: 'sess-1',
    })
    expect(inserts[0].planned_session_id).toBe('sess-1')
  })

  it('ORS_NO_ROUTE on all seeds writes nothing and surfaces the sentinel', async () => {
    const inserts: Record<string, unknown>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, text: async () => 'no route' }))
    )
    const supabase = makeSupabase({ onInsert: (row) => inserts.push(row) })
    await expect(
      suggestRoute(supabase, 'u1', {
        distanceKm: 5,
        terrain: 'flat',
        coord: { lng: -0.1, lat: 51.5 },
      })
    ).rejects.toThrow(ORS_NO_ROUTE)
    expect(inserts).toHaveLength(0)
  })
})

describe('distance-first selection', () => {
  const coord = { lng: -0.1, lat: 51.5 }
  /** Mock fetch returning [ascent, distance] per call; records the request bodies. */
  function stub(cands: Array<[number, number]>) {
    const bodies: Array<{ options: { round_trip: { length: number; seed: number } } }> = []
    let call = 0
    const fn = vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body))
      const [a, d] = cands[call++] ?? cands[cands.length - 1]
      return orsResponse(a, d)
    })
    vi.stubGlobal('fetch', fn)
    return { bodies, fn }
  }

  it('scales the next request length down after a 30% overshoot', async () => {
    const { bodies } = stub([[10, 6500], [10, 5000], [10, 5000]])
    await suggestRoute(makeSupabase({}), 'u1', { distanceKm: 5, terrain: 'flat', coord })
    expect(bodies[0].options.round_trip.length).toBe(5000)
    expect(bodies[1].options.round_trip.length).toBe(3846)
    expect(bodies.map((b) => b.options.round_trip.seed)).toEqual([0, 1, 2])
  })

  it('prefers an in-tolerance candidate over a flatter out-of-tolerance one', async () => {
    stub([[5, 6500], [40, 5200], [60, 3000]])
    const r = await suggestRoute(makeSupabase({}), 'u1', { distanceKm: 5, terrain: 'flat', coord })
    expect(r.distanceM).toBe(5200)
    expect(r.distanceWithinTolerance).toBe(true)
  })

  it('terrain decides among in-tolerance candidates', async () => {
    stub([[30, 5100], [10, 4900], [80, 7000]])
    const flat = await suggestRoute(makeSupabase({}), 'u1', { distanceKm: 5, terrain: 'flat', coord })
    expect(flat.ascentM).toBe(10)
    stub([[30, 5100], [10, 4900], [80, 7000]])
    const hill = await suggestRoute(makeSupabase({}), 'u1', { distanceKm: 5, terrain: 'uphill', coord })
    expect(hill.ascentM).toBe(30)
  })

  it('none in tolerance: closest by distance wins and is flagged', async () => {
    stub([[5, 6500], [90, 5700], [20, 3000]])
    const r = await suggestRoute(makeSupabase({}), 'u1', { distanceKm: 5, terrain: 'flat', coord })
    expect(r.distanceM).toBe(5700)
    expect(r.distanceWithinTolerance).toBe(false)
  })

  it('never makes more than 3 ORS calls', async () => {
    const { fn } = stub([[10, 9000]])
    await suggestRoute(makeSupabase({}), 'u1', { distanceKm: 5, terrain: 'flat', coord })
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('failures write no row', async () => {
    const inserts: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => '' })))
    await expect(
      suggestRoute(makeSupabase({ onInsert: (r) => inserts.push(r) }), 'u1', {
        distanceKm: 5,
        terrain: 'flat',
        coord,
      })
    ).rejects.toThrow()
    expect(inserts).toHaveLength(0)
  })

  it('selectCandidate / nextRoundTripLength helpers', () => {
    const { chosen } = selectCandidate(
      [{ distanceM: 100, ascentM: 1 }, { distanceM: 1050, ascentM: 9 }],
      'flat',
      1000
    )
    expect(chosen.ascentM).toBe(9)
    // clamped to 0.5x of the request
    expect(nextRoundTripLength(10000, 10000, 100000)).toBe(5000)
    // clamped to 1.5x
    expect(nextRoundTripLength(10000, 10000, 1000)).toBe(15000)
  })
})
