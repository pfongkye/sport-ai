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
import { resolveLimits, type RaceGoal, type ResolvedLimits } from '@/lib/plan/race-goal'

export type Phase = 'base' | 'build' | 'peak' | 'recovery' | 'taper' | 'race'

export const MIN_GOAL_LEAD_DAYS = 7
export const MAX_PLAN_WEEKS = 24
export const DEFAULT_PLAN_WEEKS = 12
/** Max week-over-week volume increase (spec Req 1.6). */
export const RAMP_RATE = 0.1
/** Sanity floor only. The real baseline (history or training-day fallback) comes from the training recap. */
export const MIN_START_KM = 5
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
  /** Longest a single non-race run may be this week (the race week uses the race-week run cap). */
  maxLongRunKm: number
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
  /** The race on the goal date (always a slot date), or null for a general block. */
  race: { date: string; distanceKm: number; targetTimeS: number | null } | null
  /** Effective per-distance limits used to build the weeks. */
  limits: ResolvedLimits
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

const round1 = (n: number) => Math.round(n * 10) / 10

/** Taper load factors (applied to the peak load) by number of taper weeks. */
const TAPER_FACTORS: Record<number, number[]> = { 1: [0.7], 2: [0.75, 0.55], 3: [0.8, 0.65, 0.5] }
const MAX_TAPER_WEEKS = 3

/**
 * Taper weeks for a race: the weeks BEFORE the race week whose Sunday is on or after
 * raceDate - taperDays, at most 3, and always leaving at least one build week.
 */
export function raceTaperWeeks(
  firstMonday: string,
  totalWeeks: number,
  raceDate: string,
  taperDays: number
): number {
  const threshold = addDays(raceDate, -taperDays)
  let n = 0
  for (let i = 0; i < totalWeeks - 1; i++) {
    if (addDays(firstMonday, i * 7 + 6) >= threshold) n++
  }
  return Math.max(0, Math.min(n, MAX_TAPER_WEEKS, totalWeeks - 2))
}

export interface SkeletonInput {
  today: string
  goalDate: string | null
  trainingDays: string[] | null | undefined
  /** Starting weekly run km, from `computeTrainingRecap().baseline.weeklyKm`. */
  baselineWeeklyKm: number
  /** The race on the goal date; null/undefined = general block (legacy behavior). */
  race?: RaceGoal | null
  /** Resolved limits; defaults to resolveLimits(race, null). */
  limits?: ResolvedLimits
}

export function buildSkeleton(input: SkeletonInput): Skeleton {
  const { startDate, endDate, hasGoalDate } = computeWindow(input.today, input.goalDate)
  const trainingDayIndexes = normalizeTrainingDays(input.trainingDays)
  const goalRace = hasGoalDate ? (input.race ?? null) : null
  const limits = input.limits ?? resolveLimits(goalRace, null)
  const raceKm = goalRace?.distanceKm ?? 0
  const raceCap = limits.raceWeekRunCapKm ?? 0

  // Monday-aligned calendar weeks overlapping [startDate, endDate].
  const firstMonday = mondayOf(startDate)
  const totalWeeks = Math.floor(diffDays(firstMonday, mondayOf(endDate)) / 7) + 1
  const taperWeeks = goalRace
    ? raceTaperWeeks(firstMonday, totalWeeks, endDate, limits.taperDays)
    : taperWeeksFor(totalWeeks, hasGoalDate)
  // With a race the last week is the race week, which is neither build nor taper.
  const buildWeeks = totalWeeks - taperWeeks - (goalRace ? 1 : 0)
  const baseWeeks = Math.ceil(buildWeeks * 0.3)

  // Weekly "full" volume per week (before partial-week scaling).
  const startKm = Math.min(Math.max(input.baselineWeeklyKm, MIN_START_KM), limits.maxWeeklyKm)
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
    // `full` is judged on the regular training days; the race date is added on top below.
    const full = slotDates.length === trainingDayIndexes.length
    const isRaceWeek = goalRace != null && i === totalWeeks - 1
    if (isRaceWeek && !slotDates.includes(endDate)) slotDates.push(endDate)
    const regularSlots = slotDates.filter((d) => d !== endDate || !isRaceWeek).length

    let phase: Phase
    let load: number
    if (isRaceWeek) {
      phase = 'race'
      load = raceKm + round1(Math.min(0.3 * peak, 2 * raceCap))
    } else if (i >= buildWeeks) {
      // Taper: step down from the peak load.
      const k = i - buildWeeks // 0-based within taper
      const factors = goalRace ? TAPER_FACTORS[taperWeeks] : taperWeeks === 2 ? [0.7, 0.5] : [0.6]
      phase = 'taper'
      load = peak * factors[k]
    } else if (i % 4 === 3 && i !== buildWeeks - 1 && buildWeeks > 4) {
      phase = 'recovery'
      load = lastLoad * RECOVERY_FACTOR
    } else {
      // First build week stays at the athlete's baseline; then +10% per build week.
      const prev = i === 0 ? null : lastLoad
      load = prev == null ? startKm : Math.min(prev * (1 + RAMP_RATE), limits.maxWeeklyKm)
      // After a recovery week resume modestly from the pre-recovery peak.
      if (weeks[i - 1]?.phase === 'recovery') load = Math.min(lastLoad * (1 + RAMP_RATE / 2), limits.maxWeeklyKm)
      phase = i < baseWeeks ? 'base' : 'build'
      if (hasGoalDate && (taperWeeks > 0 || goalRace) && i === buildWeeks - 1 && buildWeeks >= 4) phase = 'peak'
      lastLoad = load
      peak = Math.max(peak, load)
    }

    const scale = trainingDayIndexes.length ? regularSlots / trainingDayIndexes.length : 0
    const loadCapKm = Math.min(load * limits.longRunShare, limits.maxLongRunKm)
    // The race week's volume is the race plus a short shake-out, not a share of the training load.
    const targetKm = isRaceWeek ? round1(load) : round1(load * scale)
    const longRunKm =
      !isRaceWeek && regularSlots >= 3 ? round1(loadCapKm * Math.min(1, scale + 0.25)) : 0
    const maxLongRunKm = isRaceWeek ? raceCap : round1(loadCapKm)
    weeks.push({ index: i, weekStart, phase, targetKm, longRunKm, maxLongRunKm, slotDates, full })
  }

  return {
    startDate,
    endDate,
    hasGoalDate,
    totalWeeks,
    taperWeeks,
    trainingDayIndexes,
    weeks,
    race: goalRace ? { date: endDate, distanceKm: goalRace.distanceKm, targetTimeS: goalRace.targetTimeS } : null,
    limits,
  }
}

/** The day before the race (no training session may be scheduled there), or null without a race. */
export function raceDayBefore(sk: Skeleton): string | null {
  return sk.race ? addDays(sk.race.date, -1) : null
}

/** Slot weekday check used by guardrails. */
export function isSlotDate(sk: Skeleton, date: string): boolean {
  if (sk.race && date === sk.race.date) return true
  return sk.trainingDayIndexes.includes(weekdayIndex(date))
}
