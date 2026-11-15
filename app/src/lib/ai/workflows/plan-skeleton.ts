/**
 * Deterministic plan skeleton: the window, the Monday-aligned weeks, which dates
 * are training slots, the phase of each week and its weekly volume target.
 * No LLM, no I/O. The LLM only fills in the qualitative content inside this
 * structure, so it can never invent an unsafe ramp or schedule past the goal.
 */
import {
  addDays,
  diffDays,
  isIsoDate,
  mondayOf,
  weekdayIndex,
  WEEKDAY_NAMES,
} from '@/lib/plan/dates'

export type Phase = 'base' | 'build' | 'peak' | 'recovery' | 'taper'

export const MIN_GOAL_LEAD_DAYS = 7
export const MAX_PLAN_WEEKS = 24
export const DEFAULT_PLAN_WEEKS = 12
/** Max week-over-week volume increase (spec Req 1.6). */
export const RAMP_RATE = 0.1
export const MIN_START_KM = 15
export const MAX_WEEKLY_KM = 110
const RECOVERY_FACTOR = 0.8
const DEFAULT_TRAINING_DAYS = ['monday', 'wednesday', 'friday', 'saturday']

export class SkeletonError extends Error {
  constructor(
    public code: 'GOAL_DATE_INVALID' | 'GOAL_TOO_SOON',
    message: string
  ) {
    super(message)
    this.name = 'SkeletonError'
  }
}

export interface SkeletonWeek {
  index: number
  /** Monday of this calendar week (may be before the plan start). */
  weekStart: string
  phase: Phase
  /** Target weekly run volume in km, already scaled for partial weeks. */
  targetKm: number
  /** Target long-run length in km (0 when the week has no long run slot). */
  longRunKm: number
  /** Dates in the plan window that fall on an available training day. */
  slotDates: string[]
  /** True when every training-day slot of the week is inside the window. */
  full: boolean
}

export interface Skeleton {
  startDate: string
  endDate: string
  hasGoalDate: boolean
  totalWeeks: number
  taperWeeks: number
  trainingDayIndexes: number[]
  weeks: SkeletonWeek[]
}

/** Map profile `training_days` ('monday'…) to weekday indexes; defaults when empty. */
export function normalizeTrainingDays(days: string[] | null | undefined): number[] {
  const src = days && days.length ? days : DEFAULT_TRAINING_DAYS
  const idx = new Set<number>()
  for (const d of src) {
    const i = WEEKDAY_NAMES.indexOf(String(d).trim().toLowerCase() as (typeof WEEKDAY_NAMES)[number])
    if (i >= 0) idx.add(i)
  }
  if (!idx.size) DEFAULT_TRAINING_DAYS.forEach((d) => idx.add(WEEKDAY_NAMES.indexOf(d as never)))
  return [...idx].sort((a, b) => a - b)
}

/** Plan window. Starts today; a goal date further than MAX_PLAN_WEEKS away gets a build block ending at it. */
export function computeWindow(
  today: string,
  goalDate: string | null
): { startDate: string; endDate: string; hasGoalDate: boolean } {
  if (goalDate == null) {
    return { startDate: today, endDate: addDays(today, DEFAULT_PLAN_WEEKS * 7 - 1), hasGoalDate: false }
  }
  if (!isIsoDate(goalDate)) {
    throw new SkeletonError('GOAL_DATE_INVALID', 'The goal date must be a valid YYYY-MM-DD date.')
  }
  if (diffDays(today, goalDate) < MIN_GOAL_LEAD_DAYS) {
    throw new SkeletonError(
      'GOAL_TOO_SOON',
      `The goal date must be at least ${MIN_GOAL_LEAD_DAYS} days away to build a plan.`
    )
  }
  const latestStart = addDays(goalDate, -(MAX_PLAN_WEEKS * 7 - 1))
  const startDate = latestStart > today ? latestStart : today
  return { startDate, endDate: goalDate, hasGoalDate: true }
}

/** Taper length in weeks: 2 for long blocks, 1 for medium, none for short or goal-less plans. */
export function taperWeeksFor(totalWeeks: number, hasGoalDate: boolean): number {
  if (!hasGoalDate) return 0
  if (totalWeeks >= 10) return 2
  if (totalWeeks >= 5) return 1
  return 0
}

/** Average weekly RUN km over the last 4 weeks (0 with no runs). Pure. */
export function computeBaselineWeeklyKm(
  activities: { sport_type: string; started_at: string; distance_m: number | null }[],
  now: Date
): number {
  const since = now.getTime() - 28 * 86400000
  const meters = activities
    .filter((a) => a.sport_type === 'run' && new Date(a.started_at).getTime() >= since)
    .reduce((sum, a) => sum + (a.distance_m ?? 0), 0)
  return +(meters / 1000 / 4).toFixed(1)
}

const round1 = (n: number) => Math.round(n * 10) / 10

export interface SkeletonInput {
  today: string
  goalDate: string | null
  trainingDays: string[] | null | undefined
  baselineWeeklyKm: number
}

export function buildSkeleton(input: SkeletonInput): Skeleton {
  const { startDate, endDate, hasGoalDate } = computeWindow(input.today, input.goalDate)
  const trainingDayIndexes = normalizeTrainingDays(input.trainingDays)

  // Monday-aligned calendar weeks overlapping [startDate, endDate].
  const firstMonday = mondayOf(startDate)
  const totalWeeks = Math.floor(diffDays(firstMonday, mondayOf(endDate)) / 7) + 1
  const taperWeeks = taperWeeksFor(totalWeeks, hasGoalDate)
  const buildWeeks = totalWeeks - taperWeeks
  const baseWeeks = Math.ceil(buildWeeks * 0.3)

  // Weekly "full" volume per week (before partial-week scaling).
  const startKm = Math.max(input.baselineWeeklyKm, MIN_START_KM)
  let lastLoad = startKm // last non-recovery load
  let peak = startKm
  const weeks: SkeletonWeek[] = []

  for (let i = 0; i < totalWeeks; i++) {
    const weekStart = addDays(firstMonday, i * 7)
    const slotDates: string[] = []
    for (const dayIdx of trainingDayIndexes) {
      const d = addDays(weekStart, dayIdx)
      if (d >= startDate && d <= endDate) slotDates.push(d)
    }
    const full = slotDates.length === trainingDayIndexes.length

    let phase: Phase
    let load: number
    if (i >= buildWeeks) {
      // Taper: step down from the peak load.
      const k = i - buildWeeks // 0-based within taper
      const factors = taperWeeks === 2 ? [0.7, 0.5] : [0.6]
      phase = 'taper'
      load = peak * factors[k]
    } else if (i % 4 === 3 && i !== buildWeeks - 1 && buildWeeks > 4) {
      phase = 'recovery'
      load = lastLoad * RECOVERY_FACTOR
    } else {
      // First build week stays at the athlete's baseline; then +10% per build week.
      const prev = i === 0 ? null : lastLoad
      load = prev == null ? startKm : Math.min(prev * (1 + RAMP_RATE), MAX_WEEKLY_KM)
      // After a recovery week resume modestly from the pre-recovery peak.
      if (weeks[i - 1]?.phase === 'recovery') load = Math.min(lastLoad * (1 + RAMP_RATE / 2), MAX_WEEKLY_KM)
      phase = i < baseWeeks ? 'base' : 'build'
      if (hasGoalDate && taperWeeks > 0 && i === buildWeeks - 1 && buildWeeks >= 4) phase = 'peak'
      lastLoad = load
      peak = Math.max(peak, load)
    }

    const scale = trainingDayIndexes.length ? slotDates.length / trainingDayIndexes.length : 0
    const targetKm = round1(load * scale)
    const longRunKm =
      slotDates.length >= 3 ? round1(Math.min(load * 0.35, 32) * Math.min(1, scale + 0.25)) : 0
    weeks.push({ index: i, weekStart, phase, targetKm, longRunKm, slotDates, full })
  }

  return { startDate, endDate, hasGoalDate, totalWeeks, taperWeeks, trainingDayIndexes, weeks }
}

/** Slot weekday check used by guardrails. */
export function isSlotDate(sk: Skeleton, date: string): boolean {
  return sk.trainingDayIndexes.includes(weekdayIndex(date))
}
