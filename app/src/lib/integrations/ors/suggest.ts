/**
 * Route suggestion service — the single deterministic entry point used by the
 * chat `suggestRoute` tool, the standalone `/api/routes/suggest` route, and the
 * plan "add route" action. Resolves a start coordinate, generates up to
 * `MAX_SEEDS` ORS round-trip candidates, picks one by terrain preference, and
 * caches the chosen route in `suggested_routes`.
 *
 * The Supabase client is PASSED IN (never instantiated here) so the caller
 * controls RLS scope (anon-key user client vs service-role admin).
 *
 * SECURITY: raw coordinates are never logged in plaintext here or in the client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { MAX_SEEDS } from './config'
import { orsRoundTrip, orsGeocode } from './client'
import {
  bboxOf,
  sampleElevationProfile,
  terrainScore,
  type LineString,
  type OrsRouteFeature,
} from './geo'

export type Terrain = 'flat' | 'uphill'

/** Thrown by resolveStart when no start coordinate can be determined. */
export const NO_LOCATION = 'NO_LOCATION'

export interface SuggestRouteOptions {
  distanceKm: number
  terrain: Terrain
  /** Explicit [lng,lat] start (highest priority). */
  coord?: { lng: number; lat: number } | null
  /** A named place to geocode (second priority). */
  placeText?: string | null
  /** Browser geolocation, already converted to lng-first via fromGeolocation. */
  browserCoord?: { lng: number; lat: number } | null
  /** When attaching to a plan session, link + cache against it. */
  plannedSessionId?: string | null
}

export interface ResolvedStart {
  lng: number
  lat: number
  label: string | null
}

export interface RouteResult {
  routeId: string
  requestedDistanceM: number
  distanceM: number
  ascentM: number
  descentM: number
  terrain: Terrain
  bbox: [number, number, number, number]
  geometry: LineString
  elevationProfile: Array<{ distM: number; eleM: number }>
  start: { lng: number; lat: number; label: string | null }
}

/**
 * Resolve the start coordinate via a deterministic priority chain:
 *   explicit coord → geocoded placeText → browserCoord → profile home →
 *   latest activity's first latlng point.
 * Throws NO_LOCATION when none resolve.
 */
export async function resolveStart(
  supabase: SupabaseClient<Database>,
  userId: string,
  opts: SuggestRouteOptions
): Promise<ResolvedStart> {
  // 1) Explicit coordinate.
  if (opts.coord && isFiniteCoord(opts.coord.lng, opts.coord.lat)) {
    return { lng: opts.coord.lng, lat: opts.coord.lat, label: null }
  }

  // 2) Named place → geocode.
  if (opts.placeText && opts.placeText.trim()) {
    const geo = await orsGeocode(opts.placeText.trim())
    if (geo) return { lng: geo.lng, lat: geo.lat, label: geo.label }
  }

  // 3) Browser geolocation (already lng-first).
  if (opts.browserCoord && isFiniteCoord(opts.browserCoord.lng, opts.browserCoord.lat)) {
    return { lng: opts.browserCoord.lng, lat: opts.browserCoord.lat, label: null }
  }

  // 4) Profile home location.
  const { data: profile } = await supabase
    .from('profiles')
    .select('home_lat, home_lng, home_label')
    .eq('id', userId)
    .maybeSingle()
  if (profile && isFiniteCoord(profile.home_lng, profile.home_lat)) {
    return {
      lng: profile.home_lng as number,
      lat: profile.home_lat as number,
      label: (profile.home_label as string | null) ?? 'Home',
    }
  }

  // 5) Latest activity's first GPS point. Stored latlng is lat-first
  //    ({t, v:[lat,lng]}) — convert to lng-first here.
  const { data: activities } = await supabase
    .from('activities')
    .select('id')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(10)
  for (const a of activities ?? []) {
    const { data: streamRows } = await supabase
      .from('activity_streams')
      .select('data')
      .eq('activity_id', a.id)
      .eq('user_id', userId)
      .eq('stream_type', 'latlng')
      .limit(1)
    const row = streamRows?.[0]
    const pts = row?.data as Array<{ t: number; v: [number, number] }> | undefined
    const first = pts?.[0]?.v
    if (first && isFiniteCoord(first[1], first[0])) {
      // v is [lat, lng] → [lng, lat].
      return { lng: first[1], lat: first[0], label: 'Last run start' }
    }
  }

  throw new Error(NO_LOCATION, { cause: 'no start coordinate available' })
}

function isFiniteCoord(lng: unknown, lat: unknown): boolean {
  return (
    typeof lng === 'number' &&
    typeof lat === 'number' &&
    Number.isFinite(lng) &&
    Number.isFinite(lat)
  )
}

/** Normalise an ORS feature into a RouteResult (minus the persisted routeId). */
function normalise(
  feature: OrsRouteFeature,
  terrain: Terrain,
  requestedDistanceM: number,
  start: ResolvedStart
): Omit<RouteResult, 'routeId'> {
  const coords = feature.geometry.coordinates as Array<[number, number, number]>
  const bbox = bboxOf(coords)
  const elevationProfile = sampleElevationProfile(coords)
  const summary = feature.properties?.summary ?? {}
  const distanceM = Math.round(
    typeof summary.distance === 'number' ? summary.distance : requestedDistanceM
  )
  const ascentM = Math.round(terrainScore(feature))
  const descentM = Math.round(
    (typeof summary.descent === 'number' ? summary.descent : feature.properties?.descent) ?? 0
  )
  return {
    requestedDistanceM,
    distanceM,
    ascentM,
    descentM,
    terrain,
    bbox,
    geometry: { type: 'LineString', coordinates: coords },
    elevationProfile,
    start: { lng: start.lng, lat: start.lat, label: start.label },
  }
}

/**
 * Suggest a round-trip route of ~`distanceKm` km near a resolved start, biased
 * flat (min ascent) or uphill (max ascent). Persists ONE row to
 * `suggested_routes` only after a valid route is chosen (never a partial row),
 * and returns the normalised result incl. the new `routeId`.
 *
 * Errors propagate as sentinels (NO_LOCATION / ORS_*) for the caller to map via
 * orsErrorResponse; nothing is written on failure.
 */
export async function suggestRoute(
  supabase: SupabaseClient<Database>,
  userId: string,
  opts: SuggestRouteOptions
): Promise<RouteResult> {
  const start = await resolveStart(supabase, userId, opts)
  const requestedDistanceM = Math.round(opts.distanceKm * 1000)

  // Generate up to MAX_SEEDS candidates; keep the first ORS error to rethrow if
  // ALL seeds fail (so the caller still gets an actionable sentinel).
  const candidates: OrsRouteFeature[] = []
  let firstError: unknown = null
  for (let seed = 0; seed < MAX_SEEDS; seed++) {
    try {
      const feature = await orsRoundTrip({
        lng: start.lng,
        lat: start.lat,
        lengthM: requestedDistanceM,
        seed,
      })
      candidates.push(feature)
    } catch (err) {
      if (firstError === null) firstError = err
    }
  }

  if (candidates.length === 0) {
    throw firstError ?? new Error('ORS_NO_ROUTE')
  }

  // Select by terrain: flat → least ascent, uphill → most ascent.
  const chosen = candidates.reduce((best, c) => {
    const bestScore = terrainScore(best)
    const score = terrainScore(c)
    if (opts.terrain === 'uphill') return score > bestScore ? c : best
    return score < bestScore ? c : best
  })

  const normalised = normalise(chosen, opts.terrain, requestedDistanceM, start)

  // Persist ONE row AFTER a valid route is chosen.
  const insert = {
    user_id: userId,
    planned_session_id: opts.plannedSessionId ?? null,
    requested_distance_m: normalised.requestedDistanceM,
    distance_m: normalised.distanceM,
    ascent_m: normalised.ascentM,
    descent_m: normalised.descentM,
    terrain: normalised.terrain,
    start_lat: start.lat,
    start_lng: start.lng,
    start_label: start.label,
    geometry: normalised.geometry as unknown,
    elevation_profile: normalised.elevationProfile as unknown,
    bbox: normalised.bbox as unknown,
  }
  const { data: inserted, error } = await supabase
    .from('suggested_routes')
    .insert(insert)
    .select('id')
    .single()
  if (error) throw new Error(`Failed to save suggested route: ${error.message}`)

  return { ...normalised, routeId: (inserted as { id: string }).id }
}
