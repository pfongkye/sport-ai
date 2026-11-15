import { describe, it, expect } from 'vitest'
import { toRouteFeature, routeBounds } from './route-geo'

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
