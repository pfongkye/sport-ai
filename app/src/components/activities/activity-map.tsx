'use client'

import { MapContainer, TileLayer, Polyline, CircleMarker } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

interface ActivityMapProps {
  /** Array of [lat, lng] points */
  path: [number, number][]
}

export default function ActivityMap({ path }: ActivityMapProps) {
  if (!path.length) return null

  // Compute bounds center
  const lats = path.map((p) => p[0])
  const lngs = path.map((p) => p[1])
  const center: [number, number] = [
    (Math.min(...lats) + Math.max(...lats)) / 2,
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
  ]

  const start = path[0]
  const end = path[path.length - 1]

  return (
    <MapContainer
      center={center}
      zoom={14}
      scrollWheelZoom={false}
      style={{ height: '320px', width: '100%', borderRadius: '0.5rem' }}
      bounds={path.length > 1 ? (path as [number, number][]) : undefined}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Polyline positions={path} pathOptions={{ color: '#f97316', weight: 4 }} />
      <CircleMarker center={start} radius={6} pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 }} />
      <CircleMarker center={end} radius={6} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }} />
    </MapContainer>
  )
}
