/**
 * Deterministic training recap (spec Req 6). Pure: no LLM, no I/O, no clock
 * reads, no randomness. The same inputs always give the same output.
 *
 * Looks at the last RECAP_WEEKS complete Monday-based weeks (athlete timezone)
 * and reports only what the data supports. A missing value is `null`, never a
 * guess (AGENTS.md #23). Intervals are not detected from streams.
 */
import { addDays, localDateInTz, mondayOf } from '@/lib/plan/dates'
import { normalizeTrainingDays } from './plan-skeleton'

export const RECAP_SCHEMA_VERSION = 1

// ── Tunable constants (open points; every one is covered by tests) ──────────
/** Complete Monday-based weeks analysed (the current partial week is not counted). */
export const RECAP_WEEKS = 6
/** How many of the most recent weeks count as "recent". */
export const RECENT_WEEKS = 4
/** Weight of the RECENT_WEEKS most recent weeks in weighted means. */
export const RECENT_WEIGHT = 2
/** Weight of the older weeks. */
export const OLDER_WEIGHT = 1
/** A week qualifies only with at least this many activities (any sport). */
export const MIN_ACTIVITIES_PER_WEEK = 2
/** Fewer qualifying weeks than this = sparse history (fallback baseline + conservative prompt). */
export const MIN_QUALIFYING_WEEKS = 3
/** Sparse fallback: weekly run km per training day. */
export const KM_PER_TRAINING_DAY = 3
export const MIN_FALLBACK_KM = 6
export const MAX_FALLBACK_KM = 20
/** A week's run km is capped at this multiple of the median qualifying week for the baseline. */
export const OUTLIER_CAP_FACTOR = 1.5
/** The outlier cap only applies with at least this many qualifying weeks (a median needs company). */
export const OUTLIER_MIN_WEEKS = 3
/** A run is "long" if it is its week's longest run and >= this multiple of the median run distance. */
export const LONG_RUN_MEDIAN_RATIO = 1.5
/** Average HR below this share of max HR = easy; at or above HARD_HR_MIN_PCT = hard; between = moderate. */
export const EASY_HR_MAX_PCT = 0.75
export const HARD_HR_MIN_PCT = 0.85
/** With no HR: pace at or below this share of the median pace = tempo-like / hard (faster = smaller). */
export const TEMPO_PACE_RATIO = 0.93
export const HARD_PACE_RATIO = 0.85
/** Recent mean vs older mean weekly km: change beyond this share is a trend. */
export const TREND_THRESHOLD_PCT = 0.15
/** Plausible max HR range accepted from data. */
export const MIN_PLAUSIBLE_MAX_HR = 120
export const MAX_PLAUSIBLE_MAX_HR = 230
/** Plausible run pace bounds (s/km); anything outside is treated as missing. */
export const MIN_PLAUSIBLE_PACE = 120
export const MAX_PLAUSIBLE_PACE = 900
/** HR zone bounds as a share of max HR (index 0 = zone 1). */
export const HR_ZONE_PCT: readonly (readonly [number, number])[] = [
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 0.8],
  [0.8, 0.9],
  [0.9, 1.0],
]

export interface RecapActivity {
  sport_type: string
  started_at: string
  distance_m: number | null
  duration_s: number | null
  avg_hr_bpm?: number | null
  max_hr_bpm?: number | null
  avg_pace_s_per_km?: number | null
  training_load?: number | null
}

export interface RecapProfile {
  dateOfBirth?: string | null
  trainingDays?: string[] | null
  /** IANA timezone used to assign activities to local days. */
  timezone?: string | null
}

export type RunLabel = 'long' | 'easy' | 'tempo' | 'hard'

export interface RecapWeek {
  weekStart: string
  qualifies: boolean
  /** Why the week is excluded; null when it qualifies. */
  reason: string | null
  activityCount: number
  runCount: number
  runKm: number
  longestRunKm: number | null
  avgPaceSPerKm: number | null
  avgHr: number | null
  totalLoad: number | null
  otherSessions: number
  otherHours: number
  /** True when the week's km was capped for the baseline. */
  capped: boolean
}

export interface TrainingRecap {
  schemaVersion: number
  today: string
  window: { start: string; end: string }
  weeks: RecapWeek[]
  qualifyingWeeks: number
  excludedWeeks: { weekStart: string; reason: string }[]
  /** True when there are fewer than MIN_QUALIFYING_WEEKS qualifying weeks. */
  sparse: boolean
  baseline: {
    weeklyKm: number
    source: 'history' | 'fallback'
    /** Training-day scaled fallback, always computed. */
    fallbackKm: number
    /** Weighted mean before the outlier cap; null when no qualifying week. */
    uncappedKm: number | null
  }
  typical: {
    runsPerWeek: number | null
    easyPaceSPerKm: number | null
    tempoPaceSPerKm: number | null
    longRunKm: number | null
    longRunPaceSPerKm: number | null
  }
  maxHr: { bpm: number; source: 'data' | 'age' } | null
  /** Shares by run count; null without max HR or runs with HR. */
  intensity: { easy: number; moderate: number; hard: number; runsWithHr: number } | null
  trend: { direction: 'up' | 'down' | 'stable'; changePct: number } | null
  layoff: { zeroActivityWeeks: number; longestGapWeeks: number }
  otherSports: { sport: string; sessions: number; hours: number }[]
  dataQuality: {
    runsCounted: number
    missingHrShare: number | null
    missingPaceShare: number | null
    /** Runs with no distance (treadmill / no GPS, as far as detectable). */
    noDistanceShare: number | null
    notes: string[]
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100

function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function weightedMean(items: { value: number; weight: number }[]): number | null {
  const w = items.reduce((a, i) => a + i.weight, 0)
  if (!w) return null
  return items.reduce((a, i) => a + i.value * i.weight, 0) / w
}

interface RunInfo {
  weekIdx: number
  km: number | null
  paceSPerKm: number | null
  avgHr: number | null
  durationS: number | null
  label: RunLabel | null
}

function runPace(a: RecapActivity): number | null {
  const direct = a.avg_pace_s_per_km
  const derived =
    a.distance_m && a.distance_m > 0 && a.duration_s && a.duration_s > 0
      ? a.duration_s / (a.distance_m / 1000)
      : null
  const p = direct && direct > 0 ? direct : derived
  return p != null && p >= MIN_PLAUSIBLE_PACE && p <= MAX_PLAUSIBLE_PACE ? p : null
}

/** Whole years between a YYYY-MM-DD birth date and `today`; null when unusable. */
function ageYears(dob: string | null | undefined, today: string): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return null
  const [by, bm, bd] = dob.slice(0, 10).split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  let age = ty - by
  if (tm < bm || (tm === bm && td < bd)) age -= 1
  return age >= 10 && age <= 100 ? age : null
}

/** Max HR in bpm: highest recorded value in the window, else 220 minus age, else null. */
export function resolveMaxHr(
  maxHrSamples: number[],
  dateOfBirth: string | null | undefined,
  today: string
): TrainingRecap['maxHr'] {
  const plausible = maxHrSamples.filter((v) => v >= MIN_PLAUSIBLE_MAX_HR && v <= MAX_PLAUSIBLE_MAX_HR)
  if (plausible.length) return { bpm: Math.round(Math.max(...plausible)), source: 'data' }
  const age = ageYears(dateOfBirth, today)
  return age != null ? { bpm: 220 - age, source: 'age' } : null
}

/** bpm range of an HR zone (1-5) for a max HR; null for an invalid zone. */
export function hrZoneRange(zone: number, maxHr: number): { low: number; high: number } | null {
  const bounds = HR_ZONE_PCT[Math.round(zone) - 1]
  if (!bounds) return null
  return { low: Math.round(maxHr * bounds[0]), high: Math.round(maxHr * bounds[1]) }
}

/** Sparse-history fallback weekly km, scaled by the number of training days. */
export function fallbackWeeklyKm(trainingDays: string[] | null | undefined): number {
  const n = normalizeTrainingDays(trainingDays).length
  return Math.min(MAX_FALLBACK_KM, Math.max(MIN_FALLBACK_KM, n * KM_PER_TRAINING_DAY))
}

export function computeTrainingRecap(
  activities: RecapActivity[],
  profile: RecapProfile,
  today: string
): TrainingRecap {
  const thisMonday = mondayOf(today)
  const windowStart = addDays(thisMonday, -RECAP_WEEKS * 7)
  const windowEnd = addDays(thisMonday, -1)
  const weekStarts = Array.from({ length: RECAP_WEEKS }, (_, i) => addDays(windowStart, i * 7))

  // Assign each activity to a window week by its local date.
  const byWeek: RecapActivity[][] = weekStarts.map(() => [])
  for (const a of activities) {
    const t = new Date(a.started_at)
    if (Number.isNaN(t.getTime())) continue
    const local = localDateInTz(t, profile.timezone)
    if (local < windowStart || local > windowEnd) continue
    byWeek[Math.floor((Date.parse(`${local}T00:00:00Z`) - Date.parse(`${windowStart}T00:00:00Z`)) / (7 * 86400000))].push(a)
  }

  const weekWeight = (i: number) => (i >= RECAP_WEEKS - RECENT_WEEKS ? RECENT_WEIGHT : OLDER_WEIGHT)
  const qualifies = byWeek.map((w) => w.length >= MIN_ACTIVITIES_PER_WEEK)

  // Runs of qualifying weeks only (the user sees exactly what was taken into account).
  const allMaxHr: number[] = []
  const runs: RunInfo[] = []
  const runActs: RecapActivity[] = []
  byWeek.forEach((acts, wi) => {
    if (!qualifies[wi]) return
    for (const a of acts) {
      if (a.max_hr_bpm) allMaxHr.push(a.max_hr_bpm)
      if (a.sport_type !== 'run') continue
      runActs.push(a)
      runs.push({
        weekIdx: wi,
        km: a.distance_m && a.distance_m > 0 ? a.distance_m / 1000 : null,
        paceSPerKm: runPace(a),
        avgHr: a.avg_hr_bpm && a.avg_hr_bpm > 0 ? a.avg_hr_bpm : null,
        durationS: a.duration_s && a.duration_s > 0 ? a.duration_s : null,
        label: null,
      })
    }
  })

  const maxHr = resolveMaxHr(allMaxHr, profile.dateOfBirth, today)

  // ── Per-run labels, relative to the athlete's own distribution ────────────
  const medianKm = median(runs.flatMap((r) => (r.km != null ? [r.km] : [])))
  const medianPace = median(runs.flatMap((r) => (r.paceSPerKm != null ? [r.paceSPerKm] : [])))
  const longestPerWeek = new Map<number, RunInfo>()
  for (const r of runs) {
    if (r.km == null) continue
    const cur = longestPerWeek.get(r.weekIdx)
    if (!cur || r.km > (cur.km ?? 0)) longestPerWeek.set(r.weekIdx, r)
  }
  const hrClass = (r: RunInfo): 'easy' | 'moderate' | 'hard' | null => {
    if (!maxHr || r.avgHr == null) return null
    const share = r.avgHr / maxHr.bpm
    return share < EASY_HR_MAX_PCT ? 'easy' : share < HARD_HR_MIN_PCT ? 'moderate' : 'hard'
  }
  for (const r of runs) {
    if (
      r.km != null &&
      medianKm != null &&
      longestPerWeek.get(r.weekIdx) === r &&
      r.km >= medianKm * LONG_RUN_MEDIAN_RATIO
    ) {
      r.label = 'long'
      continue
    }
    const hc = hrClass(r)
    if (hc) {
      r.label = hc === 'easy' ? 'easy' : hc === 'moderate' ? 'tempo' : 'hard'
    } else if (r.paceSPerKm != null && medianPace != null) {
      const ratio = r.paceSPerKm / medianPace
      r.label = ratio <= HARD_PACE_RATIO ? 'hard' : ratio <= TEMPO_PACE_RATIO ? 'tempo' : 'easy'
    }
  }

  // ── Weekly summaries ──────────────────────────────────────────────────────
  const qualRunKm: number[] = []
  const weeks: RecapWeek[] = byWeek.map((acts, wi) => {
    const weekRuns = acts.filter((a) => a.sport_type === 'run')
    const others = acts.filter((a) => a.sport_type !== 'run')
    const km = weekRuns.reduce((s, a) => s + (a.distance_m ?? 0), 0) / 1000
    const kms = weekRuns.flatMap((a) => (a.distance_m && a.distance_m > 0 ? [a.distance_m / 1000] : []))
    const timed = weekRuns.filter((a) => runPace(a) != null && a.distance_m && a.duration_s)
    const timedKm = timed.reduce((s, a) => s + (a.distance_m ?? 0), 0) / 1000
    const timedS = timed.reduce((s, a) => s + (a.duration_s ?? 0), 0)
    const hrs = weekRuns.flatMap((a) => (a.avg_hr_bpm && a.avg_hr_bpm > 0 ? [a.avg_hr_bpm] : []))
    const loads = acts.flatMap((a) => (a.training_load != null ? [a.training_load] : []))
    if (qualifies[wi]) qualRunKm.push(km)
    return {
      weekStart: weekStarts[wi],
      qualifies: qualifies[wi],
      reason: qualifies[wi]
        ? null
        : acts.length === 0
          ? 'no activity'
          : `${acts.length} activity (minimum ${MIN_ACTIVITIES_PER_WEEK})`,
      activityCount: acts.length,
      runCount: weekRuns.length,
      runKm: round1(km),
      longestRunKm: kms.length ? round1(Math.max(...kms)) : null,
      avgPaceSPerKm: timedKm > 0 ? Math.round(timedS / timedKm) : null,
      avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
      totalLoad: loads.length ? round1(loads.reduce((a, b) => a + b, 0)) : null,
      otherSessions: others.length,
      otherHours: round1(others.reduce((s, a) => s + (a.duration_s ?? 0), 0) / 3600),
      capped: false,
    }
  })

  const qualWeeks = weeks.filter((w) => w.qualifies)
  const excludedWeeks = weeks
    .filter((w) => !w.qualifies)
    .map((w) => ({ weekStart: w.weekStart, reason: w.reason as string }))

  // ── Baseline (outlier-capped weighted mean), sparse fallback ──────────────
  const medianWeekKm = median(qualWeeks.map((w) => w.runKm))
  const capAt =
    medianWeekKm != null && qualWeeks.length >= OUTLIER_MIN_WEEKS ? medianWeekKm * OUTLIER_CAP_FACTOR : null
  const items = weeks.flatMap((w, i) => {
    if (!w.qualifies) return []
    const capped = capAt != null && capAt > 0 && w.runKm > capAt
    if (capped) w.capped = true
    return [{ value: capped ? (capAt as number) : w.runKm, weight: weekWeight(i) }]
  })
  const uncapped = weightedMean(
    weeks.flatMap((w, i) => (w.qualifies ? [{ value: w.runKm, weight: weekWeight(i) }] : []))
  )
  const historyKm = weightedMean(items)
  const fallbackKm = fallbackWeeklyKm(profile.trainingDays)
  const sparse = qualWeeks.length < MIN_QUALIFYING_WEEKS
  const baseline: TrainingRecap['baseline'] = sparse
    ? {
        weeklyKm: round1(historyKm != null && historyKm > 0 ? Math.min(historyKm, fallbackKm) : fallbackKm),
        source: 'fallback',
        fallbackKm: round1(fallbackKm),
        uncappedKm: uncapped != null ? round1(uncapped) : null,
      }
    : {
        weeklyKm: round1(historyKm ?? fallbackKm),
        source: 'history',
        fallbackKm: round1(fallbackKm),
        uncappedKm: uncapped != null ? round1(uncapped) : null,
      }

  // ── Typical values ────────────────────────────────────────────────────────
  const qualIdx = weeks.flatMap((w, i) => (w.qualifies ? [i] : []))
  const runsPerWeek = weightedMean(qualIdx.map((i) => ({ value: weeks[i].runCount, weight: weekWeight(i) })))
  const paces = (label: RunLabel) =>
    runs.flatMap((r) => (r.label === label && r.paceSPerKm != null ? [r.paceSPerKm] : []))
  const easyPace = median(paces('easy'))
  const tempoPace = median([...paces('tempo'), ...paces('hard')])
  const weeklyLongest = [...longestPerWeek.values()]
  const longKm = median(weeklyLongest.flatMap((r) => (r.km != null ? [r.km] : [])))
  const longPace = median(weeklyLongest.flatMap((r) => (r.paceSPerKm != null ? [r.paceSPerKm] : [])))

  // ── Intensity split by HR ─────────────────────────────────────────────────
  const classes = runs.flatMap((r) => {
    const c = hrClass(r)
    return c ? [c] : []
  })
  const intensity: TrainingRecap['intensity'] = classes.length
    ? {
        easy: round2(classes.filter((c) => c === 'easy').length / classes.length),
        moderate: round2(classes.filter((c) => c === 'moderate').length / classes.length),
        hard: round2(classes.filter((c) => c === 'hard').length / classes.length),
        runsWithHr: classes.length,
      }
    : null

  // ── Trend: recent weeks vs older weeks (qualifying only) ──────────────────
  const firstRecent = RECAP_WEEKS - RECENT_WEEKS
  const recentKm = qualIdx.filter((i) => i >= firstRecent).map((i) => weeks[i].runKm)
  const olderKm = qualIdx.filter((i) => i < firstRecent).map((i) => weeks[i].runKm)
  let trend: TrainingRecap['trend'] = null
  if (recentKm.length && olderKm.length) {
    const r = recentKm.reduce((a, b) => a + b, 0) / recentKm.length
    const o = olderKm.reduce((a, b) => a + b, 0) / olderKm.length
    if (o > 0) {
      const change = (r - o) / o
      trend = {
        direction: change > TREND_THRESHOLD_PCT ? 'up' : change < -TREND_THRESHOLD_PCT ? 'down' : 'stable',
        changePct: Math.round(change * 100),
      }
    }
  }

  // ── Layoff ────────────────────────────────────────────────────────────────
  let longestGap = 0
  let gap = 0
  for (const w of weeks) {
    gap = w.activityCount === 0 ? gap + 1 : 0
    longestGap = Math.max(longestGap, gap)
  }

  // ── Other sports (qualifying weeks) ───────────────────────────────────────
  const others = new Map<string, { sessions: number; seconds: number }>()
  for (const i of qualIdx) {
    for (const a of byWeek[i]) {
      if (a.sport_type === 'run') continue
      const e = others.get(a.sport_type) ?? { sessions: 0, seconds: 0 }
      e.sessions += 1
      e.seconds += a.duration_s ?? 0
      others.set(a.sport_type, e)
    }
  }
  const otherSports = [...others.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sport, e]) => ({ sport, sessions: e.sessions, hours: round1(e.seconds / 3600) }))

  // ── Data quality ──────────────────────────────────────────────────────────
  const n = runActs.length
  const share = (count: number) => (n ? round2(count / n) : null)
  const missingHr = runs.filter((r) => r.avgHr == null).length
  const missingPace = runs.filter((r) => r.paceSPerKm == null).length
  const noDistance = runs.filter((r) => r.km == null).length
  const notes: string[] = []
  if (n && missingHr / n > 0) notes.push(`${Math.round((missingHr / n) * 100)}% of runs have no heart rate`)
  if (n && missingPace / n > 0) notes.push(`${Math.round((missingPace / n) * 100)}% of runs have no usable pace`)
  if (n && noDistance / n > 0) notes.push(`${Math.round((noDistance / n) * 100)}% of runs have no distance (treadmill or no GPS)`)
  if (maxHr?.source === 'age') notes.push('Max heart rate estimated as 220 minus age (no recorded max HR)')
  if (!maxHr) notes.push('Max heart rate unknown, so no intensity split')
  if (weeks.some((w) => w.capped)) notes.push('A very large week was capped when computing your baseline')
  if (!qualWeeks.length) notes.push('No qualifying weeks in the last 6 weeks')

  return {
    schemaVersion: RECAP_SCHEMA_VERSION,
    today,
    window: { start: windowStart, end: windowEnd },
    weeks,
    qualifyingWeeks: qualWeeks.length,
    excludedWeeks,
    sparse,
    baseline,
    typical: {
      runsPerWeek: runsPerWeek != null ? round1(runsPerWeek) : null,
      easyPaceSPerKm: easyPace != null ? Math.round(easyPace) : null,
      tempoPaceSPerKm: tempoPace != null ? Math.round(tempoPace) : null,
      longRunKm: longKm != null ? round1(longKm) : null,
      longRunPaceSPerKm: longPace != null ? Math.round(longPace) : null,
    },
    maxHr,
    intensity,
    trend,
    layoff: { zeroActivityWeeks: weeks.filter((w) => w.activityCount === 0).length, longestGapWeeks: longestGap },
    otherSports,
    dataQuality: {
      runsCounted: n,
      missingHrShare: share(missingHr),
      missingPaceShare: share(missingPace),
      noDistanceShare: share(noDistance),
      notes,
    },
  }
}

/** Parse a stored snapshot; null unless it is a recap of the current schema version. */
export function asRecap(value: unknown): TrainingRecap | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<TrainingRecap>
  if (v.schemaVersion !== RECAP_SCHEMA_VERSION || !Array.isArray(v.weeks) || !v.baseline) return null
  return v as TrainingRecap
}
