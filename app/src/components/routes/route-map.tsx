'use client'

import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

/**
 * Keyless OSM raster-tile style. Swap this ONE constant to change the basemap
 * (e.g. to a vector style with your own tile key). It deliberately does NOT use
 * the ORS key — the ORS key is a server-only secret and must never reach the
 * browser.
 */
const OSM_RASTER_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

interface RouteMapProps {
  /** GeoJSON LineString, lng-first ([lng,lat] or [lng,lat,ele]). */
  geometry: { type: 'LineString'; coordinates: number[][] }
  /** [minLng, minLat, maxLng, maxLat]. */
  bbox: [number, number, number, number]
}

/**
 * Renders a suggested route line on a keyless OSM raster basemap. Loaded via
 * `next/dynamic` with `ssr: false` by callers (it touches window / WebGL).
 * The container has an explicit bounded height or MapLibre renders 0px.
 */
export default function RouteMap({ geometry, bbox }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const map = new maplibregl.Map({
      container,
      style: OSM_RASTER_STYLE,
      bounds: bbox,
      fitBoundsOptions: { padding: 32 },
      attributionControl: { compact: true },
      // Touch-friendly: pan/zoom gestures enabled (defaults), plus pinch rotate off
      // to avoid accidental rotation on mobile.
      pitchWithRotate: false,
      dragRotate: false,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    map.on('load', () => {
      map.addSource('route', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry },
      })
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#f97316', 'line-width': 4 },
      })
      map.fitBounds(bbox, { padding: 32, animate: false })
    })

    return () => {
      map.remove()
    }
  }, [geometry, bbox])

  return (
    <div
      ref={containerRef}
      className="h-[320px] w-full rounded-lg overflow-hidden"
      role="img"
      aria-label="Map of the suggested running route"
    />
  )
}
