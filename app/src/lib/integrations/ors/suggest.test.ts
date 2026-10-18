import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { resolveStart, suggestRoute, NO_LOCATION } from './suggest'
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

/** A fake ORS geo+json response feature with a given ascent. */
function orsResponse(ascent: number, distance = 5000) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-0.1, 51.5, 10],
              [-0.101, 51.501, 10 + ascent / 2],
              [-0.1, 51.5, 10],
            ],
          },
          properties: { summary: { distance, ascent, descent: ascent } },
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
