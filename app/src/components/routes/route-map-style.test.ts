import { describe, it, expect } from 'vitest'
import { MAP_MAX_ZOOM, OSM_MAX_TILE_ZOOM, OSM_RASTER_STYLE } from './route-map-style'

describe('OSM raster style', () => {
  it('caps tile requests at zoom 19 and keeps attribution', () => {
    const src = OSM_RASTER_STYLE.sources.osm as { maxzoom?: number; attribution?: string }
    expect(src.maxzoom).toBe(19)
    expect(src.attribution).toMatch(/OpenStreetMap/)
    expect(MAP_MAX_ZOOM).toBeLessThanOrEqual(OSM_MAX_TILE_ZOOM)
  })
})
