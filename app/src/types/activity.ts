import type { SportType, ActivitySource, StreamType } from './database'

/**
 * Normalized activity schema — output of all file parsers and API importers.
 * Every ingestion path (FIT, GPX, TCX, Strava, manual) produces this shape.
 */
export interface NormalizedActivity {
  source: ActivitySource
  externalId?: string
  sportType: SportType
  startedAt: Date
  durationS?: number
  distanceM?: number
  elevationGainM?: number
  avgHrBpm?: number
  maxHrBpm?: number
  avgPaceSPerKm?: number
  avgCadenceRpm?: number
  caloriesKcal?: number
  trainingLoad?: number
  notes?: string
  streams: NormalizedStream[]
  rawData: Record<string, unknown>
}

export interface NormalizedStream {
  type: StreamType
  /** Array of { t: seconds_from_start, v: value } */
  data: StreamPoint[]
}

export interface StreamPoint {
  t: number // seconds from activity start
  v: number | [number, number] // value or [lat, lng]
}

/** Lap split */
export interface LapSplit {
  lapIndex: number
  startTimeS: number
  durationS: number
  distanceM: number
  avgHrBpm?: number
  avgPaceSPerKm?: number
  avgCadenceRpm?: number
  elevationGainM?: number
}

/** Training load computation result */
export interface TrainingLoadResult {
  /** TRIMP score */
  trimp: number
  /** Acute Training Load (7-day EWMA) */
  atl?: number
  /** Chronic Training Load (42-day EWMA) */
  ctl?: number
  /** Training Stress Balance = CTL - ATL */
  tsb?: number
}

/** Readiness score derived from TSB */
export interface ReadinessResult {
  score: number // 0-100
  label: 'Fresh' | 'Optimal' | 'Tired' | 'Very Fatigued'
  message: string
  atl: number
  ctl: number
  tsb: number
}

/** Supported file formats for upload */
export type SupportedFileFormat = '.fit' | '.gpx' | '.tcx'

export const SUPPORTED_FORMATS: SupportedFileFormat[] = ['.fit', '.gpx', '.tcx']
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB
