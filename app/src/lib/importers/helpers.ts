import { createHash } from 'crypto'
import type { NormalizedActivity, StreamPoint } from '@/types/activity'

/**
 * Compute a training-load (TRIMP-style) score for an activity.
 *
 * TRIMP = duration_min * hr_ratio * weighting
 * where hr_ratio uses avg HR relative to a nominal max (185 default), and the
 * weighting is an exponential factor (Banister) approximated for general use.
 *
 * When HR is unavailable we fall back to a duration+RPE estimate so gym/football
 * sessions still contribute to load.
 */
export function computeTrainingLoad(a: {
  durationS?: number
  avgHrBpm?: number
  maxHrBpm?: number
  rpe?: number
}): number {
  const durationMin = (a.durationS ?? 0) / 60
  if (durationMin <= 0) return 0

  if (a.avgHrBpm && a.avgHrBpm > 0) {
    // Use a nominal HR reserve model. restHr 60, maxHr from data or 185.
    const restHr = 60
    const maxHr = a.maxHrBpm && a.maxHrBpm > a.avgHrBpm ? a.maxHrBpm : 185
    const hrr = Math.max(0, Math.min(1, (a.avgHrBpm - restHr) / (maxHr - restHr)))
    // Banister exponential weighting (men: 0.64 * e^(1.92x))
    const weight = 0.64 * Math.exp(1.92 * hrr)
    return +(durationMin * hrr * weight).toFixed(2)
  }

  // No HR — estimate from RPE (session RPE method: RPE * duration).
  const rpe = a.rpe ?? 5
  return +((rpe / 10) * durationMin).toFixed(2)
}

/**
 * Deterministic dedup id for an uploaded activity.
 * Same workout uploaded twice (even via different file names) → same hash.
 */
export function computeExternalId(a: NormalizedActivity): string {
  const key = [
    a.startedAt.toISOString(),
    Math.round(a.durationS ?? 0),
    Math.round(a.distanceM ?? 0),
    a.sportType,
  ].join('|')
  return `upload_${createHash('sha1').update(key).digest('hex').slice(0, 16)}`
}

/** Haversine distance between two [lat, lng] points, in meters. */
export function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Sum positive elevation gain from an altitude stream. */
export function elevationGain(points: StreamPoint[]): number {
  let gain = 0
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].v as number
    const cur = points[i].v as number
    if (typeof prev === 'number' && typeof cur === 'number' && cur > prev) {
      gain += cur - prev
    }
  }
  return +gain.toFixed(1)
}

/** Average of numeric stream values, ignoring nulls. */
export function avgOf(points: StreamPoint[]): number | undefined {
  const vals = points.map((p) => p.v).filter((v): v is number => typeof v === 'number' && v > 0)
  if (!vals.length) return undefined
  return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
}

/** Max of numeric stream values. */
export function maxOf(points: StreamPoint[]): number | undefined {
  const vals = points.map((p) => p.v).filter((v): v is number => typeof v === 'number')
  if (!vals.length) return undefined
  return Math.round(Math.max(...vals))
}

/**
 * Map a device/format sport label to our normalized sport_type.
 */
export function normalizeSport(raw?: string): NormalizedActivity['sportType'] {
  if (!raw) return 'run'
  const s = raw.toLowerCase()
  if (s.includes('run')) return 'run'
  if (s.includes('cycl') || s.includes('bike') || s.includes('ride')) return 'cycle'
  if (s.includes('soccer') || s.includes('football')) return 'football'
  if (s.includes('train') || s.includes('gym') || s.includes('strength') || s.includes('weight'))
    return 'gym'
  return 'other'
}
