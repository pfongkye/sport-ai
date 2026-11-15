/**
 * Pure helpers for drawing a suggested route on the map. Kept free of MapLibre
 * so they are unit-testable.
 */

export type Bbox = [number, number, number, number]

export interface RouteLine {
  type: 'LineString'
  coordinates: number[][]
}

export interface RouteFeature {
  type: 'Feature'
  properties: Record<string, never>
  geometry: { type: 'LineString'; coordinates: [number, number][] }
}

/** Coerce a possibly-JSON-string geometry into an object (jsonb safety). */
function asObject<T>(value: T | string): T | null {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

/**
 * Build a 2D GeoJSON Feature<LineString> from the route geometry: strips the
 * elevation component and drops non-finite points. Returns null if fewer than
 * 2 valid points remain.
 */
export function toRouteFeature(geometry: RouteLine | string): RouteFeature | null {
  const geom = asObject(geometry)
  if (!geom || !Array.isArray(geom.coordinates)) return null
  const coordinates: [number, number][] = []
  for (const c of geom.coordinates) {
    const lng = c?.[0]
    const lat = c?.[1]
    if (typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat)) {
      coordinates.push([lng, lat])
    }
  }
  if (coordinates.length < 2) return null
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }
}

/**
 * Bounds as [minLng, minLat, maxLng, maxLat]. Prefers the supplied bbox when it
 * is valid; otherwise computes from the feature's coordinates.
 */
export function routeBounds(feature: RouteFeature, bbox?: readonly number[] | null): Bbox {
  if (
    bbox &&
    bbox.length === 4 &&
    bbox.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    bbox[0] <= bbox[2] &&
    bbox[1] <= bbox[3]
  ) {
    return [bbox[0], bbox[1], bbox[2], bbox[3]]
  }
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const [lng, lat] of feature.geometry.coordinates) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return [minLng, minLat, maxLng, maxLat]
}
