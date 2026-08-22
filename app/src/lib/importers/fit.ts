import FitParser from 'fit-file-parser'
import type { NormalizedActivity, NormalizedStream, StreamPoint } from '@/types/activity'
import { avgOf, computeTrainingLoad, elevationGain, maxOf, normalizeSport } from './helpers'

/**
 * A single record row from the FIT file (list mode).
 * fit-file-parser normalizes field names; positions come back as degrees.
 */
interface FitRecord {
  timestamp?: Date | string
  position_lat?: number
  position_long?: number
  altitude?: number
  enhanced_altitude?: number
  heart_rate?: number
  cadence?: number
  speed?: number // m/s
  enhanced_speed?: number
  distance?: number // meters
  power?: number
}

interface FitSession {
  sport?: string
  start_time?: Date | string
  total_elapsed_time?: number
  total_timer_time?: number
  total_distance?: number
  total_calories?: number
  avg_heart_rate?: number
  max_heart_rate?: number
  avg_cadence?: number
  total_ascent?: number
}

/**
 * Parse a .FIT file (Coros/Garmin/Wahoo) into a NormalizedActivity.
 * Uses session summary fields where available, falls back to record streams.
 */
export async function parseFit(buffer: Buffer): Promise<NormalizedActivity> {
  const parser = new FitParser({
    force: true,
    mode: 'list',
    speedUnit: 'm/s',
    lengthUnit: 'm',
  })

  // Convert to a plain ArrayBuffer to satisfy the parser's typing across Node versions.
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer
  const data = await parser.parseAsync(arrayBuffer)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const records: FitRecord[] = ((data as any).records ?? []) as FitRecord[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessions: FitSession[] = ((data as any).sessions ?? []) as FitSession[]
  const session = sessions[0] ?? {}

  if (!records.length && !session.start_time) {
    throw new Error('FIT file contains no records or session')
  }

  const startTime = new Date(
    (session.start_time as string | Date) ?? records[0]?.timestamp ?? Date.now()
  )

  const latlng: StreamPoint[] = []
  const altitude: StreamPoint[] = []
  const heartrate: StreamPoint[] = []
  const cadence: StreamPoint[] = []
  const pace: StreamPoint[] = []
  const power: StreamPoint[] = []

  for (const r of records) {
    if (!r.timestamp) continue
    const t = Math.round((new Date(r.timestamp).getTime() - startTime.getTime()) / 1000)
    if (t < 0) continue

    if (r.position_lat !== undefined && r.position_long !== undefined) {
      latlng.push({ t, v: [r.position_lat, r.position_long] })
    }
    const alt = r.enhanced_altitude ?? r.altitude
    if (alt !== undefined) altitude.push({ t, v: alt })
    if (r.heart_rate !== undefined) heartrate.push({ t, v: r.heart_rate })
    if (r.cadence !== undefined) cadence.push({ t, v: r.cadence })
    if (r.power !== undefined) power.push({ t, v: r.power })

    const speed = r.enhanced_speed ?? r.speed // m/s
    if (speed && speed > 0) {
      // pace s/km = 1000 / speed
      pace.push({ t, v: Math.round(1000 / speed) })
    }
  }

  const streams: NormalizedStream[] = []
  if (latlng.length) streams.push({ type: 'latlng', data: latlng })
  if (altitude.length) streams.push({ type: 'altitude', data: altitude })
  if (heartrate.length) streams.push({ type: 'heartrate', data: heartrate })
  if (cadence.length) streams.push({ type: 'cadence', data: cadence })
  if (pace.length) streams.push({ type: 'pace', data: pace })
  if (power.length) streams.push({ type: 'power', data: power })

  const durationS = Math.round(
    session.total_timer_time ??
      session.total_elapsed_time ??
      (records.length ? new Date(records[records.length - 1].timestamp!).getTime() / 1000 - startTime.getTime() / 1000 : 0)
  )
  const distanceM = session.total_distance ?? undefined

  const avgHrBpm = session.avg_heart_rate ?? avgOf(heartrate)
  const maxHrBpm = session.max_heart_rate ?? maxOf(heartrate)
  const avgCadenceRpm = session.avg_cadence ?? avgOf(cadence)
  const avgPaceSPerKm =
    distanceM && durationS > 0 ? Math.round((durationS / distanceM) * 1000) : undefined

  return {
    source: 'upload_fit',
    sportType: normalizeSport(session.sport),
    startedAt: startTime,
    durationS: durationS || undefined,
    distanceM: distanceM ? +distanceM.toFixed(1) : undefined,
    elevationGainM: session.total_ascent ?? (altitude.length ? elevationGain(altitude) : undefined),
    avgHrBpm,
    maxHrBpm,
    avgPaceSPerKm,
    avgCadenceRpm,
    caloriesKcal: session.total_calories ? Math.round(session.total_calories) : undefined,
    trainingLoad: computeTrainingLoad({ durationS, avgHrBpm, maxHrBpm }),
    streams,
    rawData: { format: 'fit', recordCount: records.length, sessionCount: sessions.length },
  }
}
