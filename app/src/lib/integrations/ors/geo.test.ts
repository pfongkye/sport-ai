import { describe, it, expect } from 'vitest'
import {
  fromGeolocation,
  bboxOf,
  sampleElevationProfile,
  terrainScore,
  type OrsRouteFeature,
} from './geo'

describe('fromGeolocation', () => {
  it('swaps lat-first geolocation into lng-first [lng, lat]', () => {
    const pos = { coords: { latitude: 51.5, longitude: -0.12 } }
    expect(fromGeolocation(pos)).toEqual([-0.12, 51.5])
  })
})

describe('bboxOf', () => {
  it('computes [minLng, minLat, maxLng, maxLat] over 2D coords', () => {
    const coords: Array<[number, number]> = [
      [-0.1, 51.5],
      [0.2, 51.0],
      [-0.3, 52.0],
    ]
    expect(bboxOf(coords)).toEqual([-0.3, 51.0, 0.2, 52.0])
  })

  it('ignores the elevation on 3D coords', () => {
    const coords: Array<[number, number, number]> = [
      [1, 2, 100],
      [3, 4, 200],
    ]
    expect(bboxOf(coords)).toEqual([1, 2, 3, 4])
  })
})

describe('sampleElevationProfile', () => {
  it('returns cumulative distance + elevation, keeping all points when under cap', () => {
    // Three points heading east at the equator; eleM taken from z.
    const coords: Array<[number, number, number]> = [
      [0, 0, 10],
      [0.001, 0, 12],
      [0.002, 0, 8],
    ]
    const prof = sampleElevationProfile(coords, 100)
    expect(prof).toHaveLength(3)
    expect(prof[0]).toEqual({ distM: 0, eleM: 10 })
    expect(prof[1].eleM).toBe(12)
    expect(prof[2].eleM).toBe(8)
    // Distances are monotonically increasing.
    expect(prof[1].distM).toBeGreaterThan(prof[0].distM)
    expect(prof[2].distM).toBeGreaterThan(prof[1].distM)
  })

  it('decimates to maxPoints, keeping first and last', () => {
    const coords: Array<[number, number, number]> = []
    for (let i = 0; i < 500; i++) coords.push([i * 0.0001, 0, i])
    const prof = sampleElevationProfile(coords, 50)
    expect(prof).toHaveLength(50)
    expect(prof[0].eleM).toBe(0)
    expect(prof[prof.length - 1].eleM).toBe(499)
  })

  it('returns [] for empty input', () => {
    expect(sampleElevationProfile([], 100)).toEqual([])
  })
})

describe('terrainScore + terrain selection', () => {
  const mk = (ascent: number): OrsRouteFeature => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [] },
    properties: { summary: { ascent } },
  })

  it('reads ascent from properties.summary.ascent', () => {
    expect(terrainScore(mk(123))).toBe(123)
  })

  it('falls back to properties.ascent', () => {
    const f: OrsRouteFeature = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [] },
      properties: { ascent: 77 },
    }
    expect(terrainScore(f)).toBe(77)
  })

  it('defaults to 0 when ascent is absent', () => {
    const f: OrsRouteFeature = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [] },
      properties: {},
    }
    expect(terrainScore(f)).toBe(0)
  })

  it('flat selects the MIN ascent, uphill selects the MAX ascent', () => {
    const candidates = [mk(50), mk(10), mk(90)]
    const flat = candidates.reduce((best, c) =>
      terrainScore(c) < terrainScore(best) ? c : best
    )
    const uphill = candidates.reduce((best, c) =>
      terrainScore(c) > terrainScore(best) ? c : best
    )
    expect(terrainScore(flat)).toBe(10)
    expect(terrainScore(uphill)).toBe(90)
  })
})
