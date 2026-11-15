'use client'

import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import { routeBounds, toRouteFeature, type RouteLine } from './route-geo'
import 'maplibre-gl/dist/maplibre-gl.css'

/**
 * Keyless OSM raster-tile style. Swap this ONE constant to change the basemap
 * (e.g. to a vector style with your own tile key). It deliberately does NOT use
 * the ORS key — the ORS key is a server-only secret and must never reach the
 * browser.
 */
// Bundlers rewrite import.meta.url inside maplibre-gl, so its default worker URL
// resolves to '' and GeoJSON sources never load (AGENTS.md #39). Point it at the
// same-origin copy made by scripts/copy-maplibre-worker.mjs.
maplibregl.setWorkerUrl('/maplibre-gl-worker.mjs')

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
  geometry: RouteLine
  /** [minLng, minLat, maxLng, maxLat]. */
  bbox: [number, number, number, number]
}

const SOURCE_ID = 'route'
const FIT_PADDING = 40

/**
 * Renders a suggested route line on a keyless OSM raster basemap. Loaded via
 * `next/dynamic` with `ssr: false` by callers (it touches window / WebGL).
 * The container has an explicit bounded height or MapLibre renders 0px.
 * The map is created once; later route changes replace the source data.
 */
export default function RouteMap({ geometry, bbox }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const map = new maplibregl.Map({
      container,
      style: OSM_RASTER_STYLE,
      center: [0, 0],
      zoom: 1,
      attributionControl: { compact: true },
      // Touch-friendly: pan/zoom gestures enabled; rotation off to avoid
      // accidental rotation on mobile.
      pitchWithRotate: false,
      dragRotate: false,
    })
    map.touchZoomRotate.disableRotation()
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map
    const resize = new ResizeObserver(() => map.resize())
    resize.observe(container)
    return () => {
      resize.disconnect()
      markerRef.current?.remove()
      markerRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const feature = toRouteFeature(geometry)
    if (!map || !feature) return

    const apply = () => {
      const existing = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
      if (existing) {
        existing.setData(feature)
      } else {
        map.addSource(SOURCE_ID, { type: 'geojson', data: feature })
        const layout = { 'line-join': 'round', 'line-cap': 'round' } as const
        map.addLayer({
          id: 'route-casing',
          type: 'line',
          source: SOURCE_ID,
          layout,
          paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 },
        })
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: SOURCE_ID,
          layout,
          paint: { 'line-color': '#e11d48', 'line-width': 4.5 },
        })
      }
      markerRef.current?.remove()
      const [lng, lat] = feature.geometry.coordinates[0]
      markerRef.current = new maplibregl.Marker({ color: '#16a34a' }).setLngLat([lng, lat]).addTo(map)
      map.fitBounds(routeBounds(feature, bbox), { padding: FIT_PADDING, animate: false, maxZoom: 17 })
    }

    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
    return () => {
      map.off('load', apply)
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
