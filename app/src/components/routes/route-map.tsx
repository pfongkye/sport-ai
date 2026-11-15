'use client'

import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import {
  ROUTE_CASING_WIDTH,
  ROUTE_LINE_WIDTH,
  kmPointsAlongLine,
  kmStepForZoom,
  routeBounds,
  toRouteFeature,
  type RouteLine,
} from './route-geo'
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
const ARROW_IMAGE_ID = 'route-arrow'

/** White right-pointing chevron with a dark outline, so it reads on the red line. */
function createArrowImage(): ImageData | null {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(11, 7)
  ctx.lineTo(21, 16)
  ctx.lineTo(11, 25)
  ctx.strokeStyle = 'rgba(136, 19, 55, 0.6)'
  ctx.lineWidth = 8
  ctx.stroke()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 5
  ctx.stroke()
  return ctx.getImageData(0, 0, size, size)
}

/** Decorative, non-interactive km badge. Wrapper is the MapLibre marker element. */
function createKmElement(km: number): HTMLDivElement {
  const el = document.createElement('div')
  el.setAttribute('aria-hidden', 'true')
  el.style.pointerEvents = 'none'
  const badge = document.createElement('span')
  badge.textContent = String(km)
  badge.style.cssText =
    'display:flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 4px;' +
    'box-sizing:border-box;border-radius:9999px;background:#fff;color:#be123c;border:2px solid #e11d48;' +
    'font:700 11px/1 system-ui,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.35);pointer-events:none'
  el.appendChild(badge)
  return el
}

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
  const kmMarkersRef = useRef<{ km: number; marker: maplibregl.Marker; el: HTMLElement }[]>([])

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
      kmMarkersRef.current.forEach((k) => k.marker.remove())
      kmMarkersRef.current = []
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
          paint: { 'line-color': '#ffffff', 'line-width': ROUTE_CASING_WIDTH, 'line-opacity': 0.9 },
        })
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: SOURCE_ID,
          layout,
          paint: { 'line-color': '#e11d48', 'line-width': ROUTE_LINE_WIDTH },
        })
        // Direction chevrons repeated along the line (icon-only: the style has no glyphs).
        if (!map.hasImage(ARROW_IMAGE_ID)) {
          const img = createArrowImage()
          if (img) map.addImage(ARROW_IMAGE_ID, img)
        }
        if (map.hasImage(ARROW_IMAGE_ID)) {
          map.addLayer({
            id: 'route-arrows',
            type: 'symbol',
            source: SOURCE_ID,
            minzoom: 11,
            layout: {
              'symbol-placement': 'line',
              'symbol-spacing': 90,
              'icon-image': ARROW_IMAGE_ID,
              'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 14, 0.55, 18, 0.8],
              'icon-rotation-alignment': 'map',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            },
          })
        }
      }
      markerRef.current?.remove()
      const [lng, lat] = feature.geometry.coordinates[0]
      markerRef.current = new maplibregl.Marker({ color: '#16a34a' }).setLngLat([lng, lat]).addTo(map)
      // Replace (never stack) km markers for the new route.
      kmMarkersRef.current.forEach((k) => k.marker.remove())
      kmMarkersRef.current = kmPointsAlongLine(feature.geometry.coordinates).map((p) => {
        const el = createKmElement(p.km)
        const marker = new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map)
        return { km: p.km, marker, el }
      })
      map.fitBounds(routeBounds(feature, bbox), { padding: FIT_PADDING, animate: false, maxZoom: 17 })
      updateKmVisibility()
    }

    // Declutter: show every km when zoomed in, every 5th / 10th when out.
    const updateKmVisibility = () => {
      const step = kmStepForZoom(map.getZoom())
      kmMarkersRef.current.forEach(({ km, el }) => {
        el.style.display = km % step === 0 ? '' : 'none'
      })
    }
    map.on('zoom', updateKmVisibility)

    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
    return () => {
      map.off('load', apply)
      map.off('zoom', updateKmVisibility)
      kmMarkersRef.current.forEach((k) => k.marker.remove())
      kmMarkersRef.current = []
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
