import { describe, it, expect } from 'vitest'
import {
  fromGeolocation,
  bboxOf,
  sampleElevationProfile,
  terrainScore,
  smoothElevation,
  computeElevationGain,
  recomputeAscent,
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
    const flat = candidates.reduce((best, c) => (terrainScore(c) < terrainScore(best) ? c : best))
    const uphill = candidates.reduce((best, c) => (terrainScore(c) > terrainScore(best) ? c : best))
    expect(terrainScore(flat)).toBe(10)
    expect(terrainScore(uphill)).toBe(90)
  })
})

// --- computed ascent/descent (smoothed + hysteresis) ---------------------------

/** Degrees of latitude per meter along a meridian (haversine R = 6371000). */
const DEG_PER_M = 180 / (Math.PI * 6371000)

/** Straight north-going line, one point every `stepM`, elevation from `ele(distM, i)`. */
function line(
  n: number,
  stepM: number,
  ele: (distM: number, i: number) => number
): Array<[number, number, number]> {
  return Array.from({ length: n }, (_, i) => [0, i * stepM * DEG_PER_M, ele(i * stepM, i)])
}

/** Deterministic pseudo-noise in [-1, 1] (no Math.random). */
function noise(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

const gain = (c: Array<[number, number, number]>) => computeElevationGain(smoothElevation(c))

describe('smoothElevation', () => {
  it('keeps length and pins first and last elevation', () => {
    const c = line(50, 10, (_d, i) => 20 + 5 * noise(i))
    const s = smoothElevation(c)
    expect(s).toHaveLength(c.length)
    expect(s[0].eleM).toBe(c[0][2])
    expect(s[s.length - 1].eleM).toBe(c[c.length - 1][2])
    expect(s[0].distM).toBe(0)
  })

  it('returns [] for empty input', () => {
    expect(smoothElevation([])).toEqual([])
  })
})

describe('computeElevationGain', () => {
  it('flat line = 0 / 0', () => {
    expect(gain(line(200, 10, () => 20))).toEqual({ ascentM: 0, descentM: 0 })
  })

  it('10 m ramp over 1 km ≈ 10 m ascent, 0 descent', () => {
    const { ascentM, descentM } = gain(line(101, 10, (d) => 20 + (d / 1000) * 10))
    expect(ascentM).toBeGreaterThan(9)
    expect(ascentM).toBeLessThan(11)
    expect(descentM).toBe(0)
  })

  it('±1 m jitter around a constant = 0', () => {
    const c = line(400, 10, (_d, i) => 30 + (i % 2 === 0 ? 1 : -1))
    expect(gain(c)).toEqual({ ascentM: 0, descentM: 0 })
  })

  it('noisy sine (2 cycles, amplitude 8 m, 7.5 km, ±2 m noise) ≈ 32 m, raw sum > 400 m', () => {
    const c = line(
      751,
      10,
      (d, i) => 15 + 8 * Math.sin((2 * Math.PI * 2 * d) / 7500) + 2 * noise(i)
    )
    let raw = 0
    for (let i = 1; i < c.length; i++) raw += Math.max(0, c[i][2] - c[i - 1][2])
    expect(raw).toBeGreaterThan(400)
    const { ascentM } = gain(c)
    expect(ascentM).toBeGreaterThan(26)
    expect(ascentM).toBeLessThan(38)
  })

  it('loop (same start/end elevation): |ascent − descent| ≤ 3', () => {
    const c = line(751, 10, (d) => 15 + 8 * Math.sin((2 * Math.PI * 2 * d) / 7500))
    const { ascentM, descentM } = gain(c)
    expect(Math.abs(ascentM - descentM)).toBeLessThanOrEqual(3)
    expect(ascentM).toBeGreaterThan(20)
  })
})

describe('recomputeAscent', () => {
  // ~11 m spacing east at the equator, flat terrain with +/-4 m alternating jitter.
  const jittery = Array.from({ length: 200 }, (_, i) => [
    i * 0.0001,
    0,
    50 + (i % 2 === 0 ? 4 : -4),
  ])

  it('gives a much lower ascent than the raw per-edge sum on a jittery series', () => {
    const rawSum = jittery.reduce(
      (acc, c, i) => (i > 0 ? acc + Math.max(0, c[2] - jittery[i - 1][2]) : acc),
      0
    )
    const out = recomputeAscent(jittery)
    expect(rawSum).toBeGreaterThan(300)
    expect(out).not.toBeNull()
    expect(out!.ascentM).toBeLessThan(10)
    expect(Number.isInteger(out!.ascentM)).toBe(true)
  })

  it('keeps a real climb', () => {
    const climb = Array.from({ length: 100 }, (_, i) => [i * 0.0001, 0, i * 0.5])
    const out = recomputeAscent(climb)
    expect(out!.ascentM).toBeGreaterThan(40)
    expect(out!.descentM).toBe(0)
  })

  it('returns null without z values', () => {
    expect(
      recomputeAscent([
        [0, 0],
        [0.001, 0],
      ])
    ).toBeNull()
    expect(recomputeAscent([])).toBeNull()
  })
})
