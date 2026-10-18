/**
 * Thin OpenRouteService (ORS) HTTP client — round-trip routing + geocoding.
 *
 * Mirrors the Strava client shape: sentinel error string consts + a
 * `classifyOrsError(status, body)` that maps a non-OK response to a sentinel
 * Error (or null for a generic failure). All calls are SERVER-SIDE only.
 *
 * SECURITY: `ORS_API_KEY` is a secret — never returned to the browser, never
 * logged. Raw coordinates are never logged in plaintext (coordinate privacy).
 *
 * Docs: https://openrouteservice.org/dev/#/api-docs
 */

import { ORS_BASE_URL, ORS_TIMEOUT_MS, getOrsApiKey } from './config'
import type { OrsRouteFeature } from './geo'

/**
 * Sentinel errors thrown by this client so callers can map them to friendly,
 * actionable messages (see errors.ts). The raw status text is attached as
 * `.cause` for logging — but NEVER log coordinates or the key alongside it.
 */
export const ORS_RATE_LIMITED = 'ORS_RATE_LIMITED' // 429
export const ORS_UNAUTHORIZED = 'ORS_UNAUTHORIZED' // 401/403 (bad/forbidden/missing key)
export const ORS_NO_ROUTE = 'ORS_NO_ROUTE' // 404 / no routable path
export const ORS_TIMEOUT = 'ORS_TIMEOUT' // AbortController fired
export const ORS_UNAVAILABLE = 'ORS_UNAVAILABLE' // 5xx / network

/**
 * Classify a non-OK ORS response into a sentinel Error, or null if it's not one
 * of the special cases (caller then throws a generic error).
 *
 * ORS returns 404 (or a routing error code in the body) when no runnable path
 * exists for the requested parameters — treated as ORS_NO_ROUTE so the caller
 * can suggest a different distance/start.
 */
export function classifyOrsError(status: number, body: string): Error | null {
  if (status === 429) return new Error(ORS_RATE_LIMITED, { cause: body })
  if (status === 401 || status === 403) return new Error(ORS_UNAUTHORIZED, { cause: body })
  if (status === 404) return new Error(ORS_NO_ROUTE, { cause: body })
  if (status >= 500) return new Error(ORS_UNAVAILABLE, { cause: body })
  // Some ORS "no route" errors come back as 4xx with a routing error code.
  if (/2010|could not find|no route|routable point/i.test(body)) {
    return new Error(ORS_NO_ROUTE, { cause: body })
  }
  return null
}

function requireKey(): string {
  const key = getOrsApiKey()
  if (!key) {
    // Owner-fixable: surfaces via orsErrorResponse(ORS_UNAUTHORIZED).
    throw new Error(ORS_UNAUTHORIZED, { cause: 'ORS_API_KEY not set' })
  }
  return key
}

/**
 * Run an async operation under a bounded timeout. On timeout, abort and throw
 * ORS_TIMEOUT. Any AbortError (ours or the caller's) is normalised to the
 * timeout sentinel.
 */
async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  external?: AbortSignal
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ORS_TIMEOUT_MS)
  const onExternalAbort = () => controller.abort()
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onExternalAbort)
  }
  try {
    return await fn(controller.signal)
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(ORS_TIMEOUT, { cause: 'request timed out' })
    }
    throw err
  } finally {
    clearTimeout(timer)
    if (external) external.removeEventListener('abort', onExternalAbort)
  }
}

export interface OrsRoundTripOptions {
  lng: number
  lat: number
  lengthM: number
  seed: number
  signal?: AbortSignal
}

/**
 * Request a single round-trip loop of ~`lengthM` meters starting at (lng, lat).
 * Uses foot-walking directions with elevation so we get ascent/descent + a 3D
 * geometry. Returns the first GeoJSON feature.
 */
export async function orsRoundTrip(opts: OrsRoundTripOptions): Promise<OrsRouteFeature> {
  const key = requireKey()
  const url = `${ORS_BASE_URL}/v2/directions/foot-walking/geojson`
  const body = JSON.stringify({
    coordinates: [[opts.lng, opts.lat]],
    options: { round_trip: { length: opts.lengthM, points: 4, seed: opts.seed } },
    elevation: true,
    instructions: false,
  })

  const run = (signal: AbortSignal) =>
    fetch(url, {
      method: 'POST',
      headers: {
        Authorization: key,
        'Content-Type': 'application/json',
        Accept: 'application/geo+json',
      },
      body,
      signal,
    })

  // Bounded timeout, honoring a caller-supplied signal too.
  const res = await withTimeout(run, opts.signal)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const classified = classifyOrsError(res.status, text)
    if (classified) throw classified
    // Generic failure — do NOT echo coordinates.
    throw new Error(ORS_UNAVAILABLE, { cause: `ORS directions failed (${res.status})` })
  }

  const json = (await res.json()) as { features?: OrsRouteFeature[] }
  const feature = json.features?.[0]
  if (!feature || !feature.geometry || !Array.isArray(feature.geometry.coordinates)) {
    throw new Error(ORS_NO_ROUTE, { cause: 'ORS returned no route feature' })
  }
  return feature
}

/**
 * Geocode a free-text place to a single coordinate. Returns null when there are
 * zero or ambiguous results (caller should ask the athlete to confirm), and
 * degrades cleanly (null) when the geocode module is absent on a self-hosted ORS.
 */
export async function orsGeocode(
  text: string,
  signal?: AbortSignal
): Promise<{ lng: number; lat: number; label: string } | null> {
  const key = requireKey()
  // Key goes in the Authorization header, NOT a query param (never leak it in a
  // URL / log). ORS accepts the Authorization header on geocode endpoints.
  const params = new URLSearchParams({ text, size: '1' })
  const url = `${ORS_BASE_URL}/geocode/search?${params.toString()}`
  const headers = { Authorization: key }

  let res: Response
  try {
    res = await withTimeout((sig) => fetch(url, { headers, signal: sig }), signal)
  } catch {
    return null // network blip / timeout / module absent → degrade to "needs a coordinate"
  }
  if (!res.ok) return null

  const json = (await res.json().catch(() => null)) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] }
      properties?: { label?: string }
    }>
  } | null

  const feature = json?.features?.[0]
  const coords = feature?.geometry?.coordinates
  if (!coords || coords.length < 2) return null
  return { lng: coords[0], lat: coords[1], label: feature?.properties?.label ?? text }
}
