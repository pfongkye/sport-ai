import { XMLParser } from 'fast-xml-parser'
import type { NormalizedActivity, NormalizedStream, StreamPoint } from '@/types/activity'
import {
  avgOf,
  computeTrainingLoad,
  elevationGain,
  haversineM,
  maxOf,
  normalizeSport,
} from './helpers'

interface GpxTrackPoint {
  '@_lat'?: string
  '@_lon'?: string
  ele?: number | string
  time?: string
  extensions?: {
    'gpxtpx:TrackPointExtension'?: {
      'gpxtpx:hr'?: number | string
      'gpxtpx:cad'?: number | string
    }
    // Some exporters flatten these
    'gpxtpx:hr'?: number | string
    'gpxtpx:cad'?: number | string
    hr?: number | string
    cad?: number | string
  }
}

/**
 * Parse a .GPX file into a NormalizedActivity.
 * GPX carries GPS + time + (optionally) HR/cadence via TrackPointExtension.
 */
export function parseGpx(xml: string): NormalizedActivity {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  })
  const doc = parser.parse(xml)

  const gpx = doc.gpx ?? {}
  const trk = Array.isArray(gpx.trk) ? gpx.trk[0] : gpx.trk
  const trkName: string | undefined = trk?.name
  const sportType = normalizeSport(trk?.type ?? gpx.metadata?.type)

  // Collect track points across all segments
  const segs = trk?.trkseg ? (Array.isArray(trk.trkseg) ? trk.trkseg : [trk.trkseg]) : []
  const rawPoints: GpxTrackPoint[] = []
  for (const seg of segs) {
    const pts = seg?.trkpt ? (Array.isArray(seg.trkpt) ? seg.trkpt : [seg.trkpt]) : []
    rawPoints.push(...pts)
  }

  if (!rawPoints.length) {
    throw new Error('GPX file contains no track points')
  }

  const latlng: StreamPoint[] = []
  const altitude: StreamPoint[] = []
  const heartrate: StreamPoint[] = []
  const cadence: StreamPoint[] = []
  const pace: StreamPoint[] = []

  const startTime = rawPoints[0].time ? new Date(rawPoints[0].time) : new Date()
  let distanceM = 0
  let prevLatLng: [number, number] | null = null
  let prevT = 0

  for (const p of rawPoints) {
    const lat = p['@_lat'] ? parseFloat(p['@_lat']) : undefined
    const lng = p['@_lon'] ? parseFloat(p['@_lon']) : undefined
    const t = p.time ? Math.round((new Date(p.time).getTime() - startTime.getTime()) / 1000) : prevT

    if (lat !== undefined && lng !== undefined) {
      latlng.push({ t, v: [lat, lng] })
      if (prevLatLng) {
        const d = haversineM(prevLatLng, [lat, lng])
        distanceM += d
        const dt = t - prevT
        if (dt > 0 && d > 0) {
          // pace in s/km for this segment
          pace.push({ t, v: Math.round((dt / d) * 1000) })
        }
      }
      prevLatLng = [lat, lng]
    }

    if (p.ele !== undefined) altitude.push({ t, v: Number(p.ele) })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext: any = p.extensions?.['gpxtpx:TrackPointExtension'] ?? p.extensions
    const hr = ext?.['gpxtpx:hr'] ?? ext?.hr
    const cad = ext?.['gpxtpx:cad'] ?? ext?.cad
    if (hr !== undefined) heartrate.push({ t, v: Number(hr) })
    if (cad !== undefined) cadence.push({ t, v: Number(cad) })

    prevT = t
  }

  const durationS = latlng.length ? latlng[latlng.length - 1].t : 0

  const streams: NormalizedStream[] = []
  if (latlng.length) streams.push({ type: 'latlng', data: latlng })
  if (altitude.length) streams.push({ type: 'altitude', data: altitude })
  if (heartrate.length) streams.push({ type: 'heartrate', data: heartrate })
  if (cadence.length) streams.push({ type: 'cadence', data: cadence })
  if (pace.length) streams.push({ type: 'pace', data: pace })

  const avgHrBpm = avgOf(heartrate)
  const maxHrBpm = maxOf(heartrate)
  const avgPaceSPerKm =
    distanceM > 0 && durationS > 0 ? Math.round((durationS / distanceM) * 1000) : undefined

  return {
    source: 'upload_gpx',
    sportType,
    startedAt: startTime,
    durationS: durationS || undefined,
    distanceM: distanceM > 0 ? +distanceM.toFixed(1) : undefined,
    elevationGainM: altitude.length ? elevationGain(altitude) : undefined,
    avgHrBpm,
    maxHrBpm,
    avgPaceSPerKm,
    avgCadenceRpm: avgOf(cadence),
    trainingLoad: computeTrainingLoad({ durationS, avgHrBpm, maxHrBpm }),
    notes: trkName,
    streams,
    rawData: { format: 'gpx', pointCount: rawPoints.length },
  }
}
