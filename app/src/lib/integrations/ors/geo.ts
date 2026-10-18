/**
 * Pure geo helpers for the ORS route pipeline. No I/O, fully unit-testable.
 *
 * The whole pipeline (ORS → GeoJSON → MapLibre) is LNG-FIRST. The only lat-first
 * source is `navigator.geolocation`, so `fromGeolocation` is the single boundary
 * that converts {latitude, longitude} → [lng, lat].
 */

/** A GeoJSON LineString geometry. Coordinates are [lng, lat] or [lng, lat, ele]. */
export interface LineString {
  type: 'LineString'
  coordinates: number[][]
}

/** The ORS GeoJSON Feature shape we care about (elevation summary + geometry). */
export interface OrsRouteFeature {
  type: 'Feature'
  geometry: LineString
  properties: {
    ascent?: number
    descent?: number
    summary?: {
      distance?: number
      duration?: number
      ascent?: number
      descent?: number
    }
    [key: string]: unknown
  }
  bbox?: number[]
}

/** The browser-geolocation shape (lat-first). */
export interface GeolocationLike {
  coords: {
    latitude: number
    longitude: number
  }
}

/**
 * Convert a `navigator.geolocation` position (lat-first) to the lng-first
 * `[lng, lat]` tuple the rest of the pipeline uses. This is the ONE place the
 * lat↔lng swap happens — centralised so the footgun is testable.
 */
export function fromGeolocation(pos: GeolocationLike): [number, number] {
  return [pos.coords.longitude, pos.coords.latitude]
}

/**
 * Axis-aligned bounding box of a set of coordinates (lng-first). Accepts 2D
 * `[lng,lat]` or 3D `[lng,lat,ele]` tuples; elevation is ignored.
 * Returns `[minLng, minLat, maxLng, maxLat]`.
 */
export function bboxOf(
  coords: Array<[number, number] | [number, number, number]>
): [number, number, number, number] {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const c of coords) {
    const lng = c[0]
    const lat = c[1]
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return [minLng, minLat, maxLng, maxLat]
}

/** Haversine distance between two lng-first points, in meters. */
function haversineLngLat(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Sample a 3D geometry (`[lng,lat,ele][]`) into an elevation profile for the UI
 * chart: `[{ distM, eleM }]` where `distM` is cumulative planar/haversine
 * distance from the start. Caps the output at `maxPoints` by uniform decimation
 * (always keeps the first and last point).
 */
export function sampleElevationProfile(
  coords3d: Array<[number, number, number]>,
  maxPoints = 100
): Array<{ distM: number; eleM: number }> {
  if (coords3d.length === 0) return []

  // Cumulative distance along the full geometry.
  const cum: number[] = [0]
  for (let i = 1; i < coords3d.length; i++) {
    const prev = coords3d[i - 1]
    const curr = coords3d[i]
    cum.push(cum[i - 1] + haversineLngLat([prev[0], prev[1]], [curr[0], curr[1]]))
  }

  const n = coords3d.length
  if (n <= maxPoints) {
    return coords3d.map((c, i) => ({ distM: Math.round(cum[i]), eleM: c[2] ?? 0 }))
  }

  // Uniform decimation to maxPoints, keeping first + last.
  const out: Array<{ distM: number; eleM: number }> = []
  for (let k = 0; k < maxPoints; k++) {
    const idx = Math.round((k * (n - 1)) / (maxPoints - 1))
    out.push({ distM: Math.round(cum[idx]), eleM: coords3d[idx][2] ?? 0 })
  }
  return out
}

/**
 * Total ascent (meters) for an ORS route feature, used to score terrain. ORS
 * puts ascent on `properties.summary.ascent` and/or `properties.ascent` when
 * `elevation: true` is requested; fall back across both and default to 0.
 */
export function terrainScore(feature: OrsRouteFeature): number {
  const summaryAscent = feature.properties?.summary?.ascent
  if (typeof summaryAscent === 'number') return summaryAscent
  const ascent = feature.properties?.ascent
  if (typeof ascent === 'number') return ascent
  return 0
}
