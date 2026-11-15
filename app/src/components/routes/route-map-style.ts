import type { StyleSpecification } from 'maplibre-gl'

/** The OSM standard tile server serves zoom 0-19 only (AGENTS.md gotcha on z20 AJAXError). */
export const OSM_MAX_TILE_ZOOM = 19

/** Highest zoom the map allows; tiles above OSM_MAX_TILE_ZOOM are overzoomed, not requested. */
export const MAP_MAX_ZOOM = 19

/**
 * Keyless OSM raster-tile style. Swap this ONE constant to change the basemap
 * (e.g. to a vector style with your own tile key). It deliberately does NOT use
 * the ORS key — the ORS key is a server-only secret and must never reach the
 * browser.
 */
export const OSM_RASTER_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: OSM_MAX_TILE_ZOOM,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}
