import { describe, it, expect } from 'vitest'
import {
  toRouteFeature,
  routeBounds,
  ROUTE_LINE_WIDTH,
  ROUTE_CASING_WIDTH,
  ROUTE_LINE_WIDTH_STOPS,
} from './route-geo'

describe('toRouteFeature', () => {
  it('strips elevation and builds a LineString Feature', () => {
    const f = toRouteFeature({ type: 'LineString', coordinates: [[-0.57, 44.84, 10], [-0.56, 44.85, 12]] })
    expect(f?.geometry.coordinates).toEqual([[-0.57, 44.84], [-0.56, 44.85]])
    expect(f?.type).toBe('Feature')
  })
  it('parses a JSON-string geometry', () => {
    const s = JSON.stringify({ type: 'LineString', coordinates: [[1, 2], [3, 4]] })
    expect(toRouteFeature(s)?.geometry.coordinates).toHaveLength(2)
  })
  it('drops invalid points and returns null when < 2 remain', () => {
    expect(toRouteFeature({ type: 'LineString', coordinates: [[1, 2], [NaN, 4]] })).toBeNull()
    expect(toRouteFeature('not json')).toBeNull()
  })
})

describe('routeBounds', () => {
  const f = toRouteFeature({ type: 'LineString', coordinates: [[-0.6, 44.8], [-0.5, 44.9]] })!
  it('uses a valid bbox', () => {
    expect(routeBounds(f, [-1, 44, 0, 45])).toEqual([-1, 44, 0, 45])
  })
  it('computes from coordinates when bbox is missing or inverted', () => {
    expect(routeBounds(f, null)).toEqual([-0.6, 44.8, -0.5, 44.9])
    expect(routeBounds(f, [0, 45, -1, 44])).toEqual([-0.6, 44.8, -0.5, 44.9])
  })
})

describe('route line width expression', () => {
  const pairs = (expr: readonly unknown[]) => {
    const flat = expr.slice(3) as number[]
    const out: [number, number][] = []
    for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]])
    return out
  }
  it('is a zoom-driven exponential interpolate', () => {
    for (const e of [ROUTE_LINE_WIDTH, ROUTE_CASING_WIDTH]) {
      expect(e.slice(0, 3)).toEqual(['interpolate', ['exponential', 1.5], ['zoom']])
      expect(pairs(e)).toHaveLength(ROUTE_LINE_WIDTH_STOPS.length)
    }
  })
  it('has strictly increasing zooms and non-decreasing widths', () => {
    for (const e of [ROUTE_LINE_WIDTH, ROUTE_CASING_WIDTH]) {
      const p = pairs(e)
      for (let i = 1; i < p.length; i++) {
        expect(p[i][0]).toBeGreaterThan(p[i - 1][0])
        expect(p[i][1]).toBeGreaterThanOrEqual(p[i - 1][1])
      }
      expect(p[0][1]).toBeGreaterThan(0)
    }
  })
  it('keeps the casing wider than the line at every stop', () => {
    const l = pairs(ROUTE_LINE_WIDTH)
    const c = pairs(ROUTE_CASING_WIDTH)
    l.forEach(([z, w], i) => {
      expect(c[i][0]).toBe(z)
      expect(c[i][1]).toBeGreaterThan(w)
    })
  })
})
