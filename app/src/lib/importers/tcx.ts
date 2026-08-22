import { XMLParser } from 'fast-xml-parser'
import type { NormalizedActivity, NormalizedStream, StreamPoint } from '@/types/activity'
import { avgOf, computeTrainingLoad, elevationGain, maxOf, normalizeSport } from './helpers'

/**
 * Parse a .TCX file (Garmin Training Center XML) into a NormalizedActivity.
 * TCX has explicit Distance/Cadence/HR per Trackpoint, so we trust its values
 * rather than recomputing from GPS.
 */
export function parseTcx(xml: string): NormalizedActivity {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
  const doc = parser.parse(xml)

  const activities = doc.TrainingCenterDatabase?.Activities?.Activity
  const activity = Array.isArray(activities) ? activities[0] : activities
  if (!activity) throw new Error('TCX file contains no Activity')

  const sportType = normalizeSport(activity['@_Sport'])

  const laps = activity.Lap ? (Array.isArray(activity.Lap) ? activity.Lap : [activity.Lap]) : []
  if (!laps.length) throw new Error('TCX Activity contains no laps')

  const startTime = activity.Id ? new Date(activity.Id) : new Date(laps[0]['@_StartTime'])

  const latlng: StreamPoint[] = []
  const altitude: StreamPoint[] = []
  const heartrate: StreamPoint[] = []
  const cadence: StreamPoint[] = []
  const pace: StreamPoint[] = []

  let totalDistanceM = 0
  let totalDurationS = 0
  let totalCalories = 0
  let prevDist = 0
  let prevT = 0

  for (const lap of laps) {
    totalDurationS += Number(lap.TotalTimeSeconds ?? 0)
    totalDistanceM += Number(lap.DistanceMeters ?? 0)
    totalCalories += Number(lap.Calories ?? 0)

    const track = lap.Track
    const points = track?.Trackpoint
      ? Array.isArray(track.Trackpoint)
        ? track.Trackpoint
        : [track.Trackpoint]
      : []

    for (const tp of points) {
      const t = tp.Time
        ? Math.round((new Date(tp.Time).getTime() - startTime.getTime()) / 1000)
        : prevT

      const pos = tp.Position
      if (pos?.LatitudeDegrees !== undefined && pos?.LongitudeDegrees !== undefined) {
        latlng.push({ t, v: [Number(pos.LatitudeDegrees), Number(pos.LongitudeDegrees)] })
      }
      if (tp.AltitudeMeters !== undefined) altitude.push({ t, v: Number(tp.AltitudeMeters) })

      const hr = tp.HeartRateBpm?.Value
      if (hr !== undefined) heartrate.push({ t, v: Number(hr) })

      // Cadence can be a direct field or under Extensions
      const cad =
        tp.Cadence ??
        tp.Extensions?.['ns3:TPX']?.['ns3:RunCadence'] ??
        tp.Extensions?.TPX?.RunCadence
      if (cad !== undefined) cadence.push({ t, v: Number(cad) })

      const dist = tp.DistanceMeters !== undefined ? Number(tp.DistanceMeters) : undefined
      if (dist !== undefined && dist > prevDist && t > prevT) {
        const dd = dist - prevDist
        const dt = t - prevT
        if (dd > 0) pace.push({ t, v: Math.round((dt / dd) * 1000) })
        prevDist = dist
      }
      prevT = t
    }
  }

  if (!latlng.length && !heartrate.length) {
    throw new Error('TCX file contains no usable trackpoints')
  }

  const streams: NormalizedStream[] = []
  if (latlng.length) streams.push({ type: 'latlng', data: latlng })
  if (altitude.length) streams.push({ type: 'altitude', data: altitude })
  if (heartrate.length) streams.push({ type: 'heartrate', data: heartrate })
  if (cadence.length) streams.push({ type: 'cadence', data: cadence })
  if (pace.length) streams.push({ type: 'pace', data: pace })

  const avgHrBpm = avgOf(heartrate)
  const maxHrBpm = maxOf(heartrate)
  const avgPaceSPerKm =
    totalDistanceM > 0 && totalDurationS > 0
      ? Math.round((totalDurationS / totalDistanceM) * 1000)
      : undefined

  return {
    source: 'upload_tcx',
    sportType,
    startedAt: startTime,
    durationS: totalDurationS || undefined,
    distanceM: totalDistanceM > 0 ? +totalDistanceM.toFixed(1) : undefined,
    elevationGainM: altitude.length ? elevationGain(altitude) : undefined,
    avgHrBpm,
    maxHrBpm,
    avgPaceSPerKm,
    avgCadenceRpm: avgOf(cadence),
    caloriesKcal: totalCalories > 0 ? Math.round(totalCalories) : undefined,
    trainingLoad: computeTrainingLoad({ durationS: totalDurationS, avgHrBpm, maxHrBpm }),
    streams,
    rawData: { format: 'tcx', lapCount: laps.length },
  }
}
