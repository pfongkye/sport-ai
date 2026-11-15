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

/** Cumulative haversine distance (meters) from the first point, per coordinate. */
function cumulativeDistances(coords: number[][]): number[] {
  const cum: number[] = coords.length ? [0] : []
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1]
    const curr = coords[i]
    cum.push(cum[i - 1] + haversineLngLat([prev[0], prev[1]], [curr[0], curr[1]]))
  }
  return cum
}

export interface ElevationPoint {
  distM: number
  eleM: number
}

/** True when every coordinate carries a finite z (elevation) value. */
export function hasElevation(coords: number[][]): boolean {
  return coords.length > 0 && coords.every((c) => Number.isFinite(c[2]))
}

/**
 * Decimate an elevation series to at most `maxPoints` (uniform by index, always
 * keeping first + last). Distances are rounded to whole meters.
 */
export function sampleProfileFromSeries(
  series: ElevationPoint[],
  maxPoints = 100
): ElevationPoint[] {
  const n = series.length
  if (n === 0) return []
  if (n <= maxPoints) {
    return series.map((p) => ({ distM: Math.round(p.distM), eleM: p.eleM }))
  }
  const out: ElevationPoint[] = []
  for (let k = 0; k < maxPoints; k++) {
    const idx = Math.round((k * (n - 1)) / (maxPoints - 1))
    out.push({ distM: Math.round(series[idx].distM), eleM: series[idx].eleM })
  }
  return out
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
  const cum = cumulativeDistances(coords3d)
  return sampleProfileFromSeries(
    coords3d.map((c, i) => ({ distM: cum[i], eleM: c[2] ?? 0 })),
    maxPoints
  )
}

/**
 * Distance-based moving average of the elevation (z) values. Each point becomes
 * the mean of all points within ±`windowM/2` meters ALONG THE ROUTE, so uneven
 * ORS point spacing is handled. First and last points are pinned to their raw
 * values so a loop keeps its start/end elevation. Output length = input length.
 */
export function smoothElevation(
  coords3d: Array<[number, number, number]>,
  windowM = 100
): ElevationPoint[] {
  const n = coords3d.length
  if (n === 0) return []
  const cum = cumulativeDistances(coords3d)
  const prefix: number[] = [0]
  for (let i = 0; i < n; i++) prefix.push(prefix[i] + (coords3d[i][2] ?? 0))

  const half = windowM / 2
  const out: ElevationPoint[] = []
  let lo = 0
  let hi = 0 // exclusive upper bound
  for (let i = 0; i < n; i++) {
    while (cum[lo] < cum[i] - half) lo++
    if (hi < i + 1) hi = i + 1
    while (hi < n && cum[hi] <= cum[i] + half) hi++
    const mean = (prefix[hi] - prefix[lo]) / (hi - lo)
    out.push({ distM: cum[i], eleM: mean })
  }
  out[0].eleM = coords3d[0][2] ?? 0
  out[n - 1].eleM = coords3d[n - 1][2] ?? 0
  return out
}

/**
 * Total ascent/descent of an elevation series using a hysteresis state machine:
 * a climb (or descent) only counts once the series has moved at least
 * `thresholdM` from the last confirmed extreme, so residual jitter is ignored.
 * Run on a smoothed series (see `smoothElevation`).
 */
export function computeElevationGain(
  series: ElevationPoint[],
  thresholdM = 3
): { ascentM: number; descentM: number } {
  let ascentM = 0
  let descentM = 0
  if (series.length < 2) return { ascentM, descentM }

  let extreme = series[0].eleM
  let dir = 0 // 0 unknown, 1 climbing, -1 descending
  for (let i = 1; i < series.length; i++) {
    const e = series[i].eleM
    if (dir === 0) {
      if (e - extreme >= thresholdM) {
        ascentM += e - extreme
        extreme = e
        dir = 1
      } else if (extreme - e >= thresholdM) {
        descentM += extreme - e
        extreme = e
        dir = -1
      }
    } else if (dir === 1) {
      if (e > extreme) {
        ascentM += e - extreme
        extreme = e
      } else if (extreme - e >= thresholdM) {
        descentM += extreme - e
        extreme = e
        dir = -1
      }
    } else {
      if (e < extreme) {
        descentM += extreme - e
        extreme = e
      } else if (e - extreme >= thresholdM) {
        ascentM += e - extreme
        extreme = e
        dir = 1
      }
    }
  }
  return { ascentM, descentM }
}

/**
 * ORS-reported ascent (meters) for a route feature. NOISY (per-edge sum over ~90 m
 * SRTM data): only a fallback when the geometry has no z-values; use
 * `computeElevationGain` for selection and display. ORS
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
