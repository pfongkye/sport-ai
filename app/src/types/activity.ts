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

// ─── Free-form / voice activity entry ───────────────────────────────────────

/**
 * One strength block parsed from a gym utterance (e.g. "2x8 squat @80kg").
 * Stored structured in `activities.raw_data.strength` and also rendered into a
 * human-readable `notes` summary for RAG retrieval. See spec
 * `.kiro/specs/voice-freeform-activity-logging`.
 */
export interface StrengthBlock {
  exercise: string
  sets: number | null
  reps: number | null
  weightKg: number | null
}

/**
 * Structured draft produced by the natural-language parser from a spoken/typed
 * sentence. Superset of the insertable manual-activity fields plus parse
 * metadata used by the confirm/edit UI. Nothing here is persisted until the
 * athlete confirms; only the activity fields map to columns (strength/transcript
 * go into raw_data).
 */
export interface ActivityDraft {
  sportType: SportType | null
  /** ISO string in the athlete's local time; null when not stated. */
  startedAt: string | null
  /** True when date and/or time were absent or vague ("last run") — UI must
   *  require the athlete to confirm the exact time before saving (dedup). */
  dateTimeNeedsConfirmation: boolean
  durationS: number | null
  distanceM: number | null
  avgHrBpm: number | null
  maxHrBpm: number | null
  avgPaceSPerKm: number | null
  avgCadenceRpm: number | null
  caloriesKcal: number | null
  rpe: number | null
  notes: string | null
  /** Structured sets/reps; empty array when none. */
  strength: StrengthBlock[]
  // ── parse metadata (not persisted as columns) ──
  /** Human-readable assumptions the parser made, shown as hints in the form. */
  assumptions: string[]
  confidence: 'high' | 'low'
  /** The original utterance/transcript, stored in raw_data for re-parsing. */
  transcript: string
}
