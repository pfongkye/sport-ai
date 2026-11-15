/**
 * Deterministic guardrails applied to the model's plan BEFORE anything is
 * written. The LLM is never trusted to self-limit (design careful-point #4).
 */
import { addDays, isIsoDate } from '@/lib/plan/dates'
import { RAMP_RATE, isSlotDate, type Skeleton } from './plan-skeleton'
import type { PlanDraft } from './plan-schema'

/** Slack on the skeleton's weekly target (the model rounds distances). */
export const TARGET_TOLERANCE = 1.15
/** Absolute slack in km so tiny weeks don't trip the ramp check on rounding. */
export const RAMP_SLACK_KM = 0.5
export const MAX_SESSIONS_PER_DAY = 2

/** Remove explicit 'rest' rows: a day with no session IS the rest day. */
export function sanitizePlan(plan: PlanDraft): PlanDraft {
  return {
    ...plan,
    sessions: plan.sessions.filter((s) => s.sessionType.trim().toLowerCase() !== 'rest'),
  }
}

const isRun = (sport: string) => sport === 'run'

/** Run km per skeleton week index (sessions assigned by date). */
export function weeklyRunKm(plan: PlanDraft, sk: Skeleton): number[] {
  return sk.weeks.map((w) => {
    const end = addDays(w.weekStart, 6)
    const m = plan.sessions
      .filter((s) => isRun(s.sportType) && s.scheduledDate >= w.weekStart && s.scheduledDate <= end)
      .reduce((sum, s) => sum + (s.targetDistanceM ?? 0), 0)
    return m / 1000
  })
}

/**
 * Returns a list of human-readable problems; empty means the plan is acceptable.
 * Checks: dates valid + inside the window + on training days, session-per-day
 * cap, a rest day in every full week, a long run in build weeks, weekly volume
 * at or under the skeleton target, and the ~10%/week ramp.
 */
export function validatePlan(plan: PlanDraft, sk: Skeleton): string[] {
  const { hard, soft } = validatePlanDetailed(plan, sk)
  return [...hard, ...soft]
}

export interface PlanIssues {
  /** Structural problems: never repaired, always reject. */
  hard: string[]
  /** Weekly volume problems: repairable by scaling distances down. */
  soft: string[]
}

/** Same checks as validatePlan, split into structural (hard) and volume (soft, repairable). */
export function validatePlanDetailed(plan: PlanDraft, sk: Skeleton): PlanIssues {
  const issues: string[] = []
  const soft: string[] = []
  if (!plan.sessions.length) return { hard: ['The plan has no training sessions.'], soft }

  const perDay = new Map<string, number>()
  for (const s of plan.sessions) {
    if (!isIsoDate(s.scheduledDate)) {
      issues.push(`Invalid date "${s.scheduledDate}".`)
      continue
    }
    if (s.scheduledDate < sk.startDate || s.scheduledDate > sk.endDate) {
      issues.push(`${s.scheduledDate} is outside the plan window ${sk.startDate}..${sk.endDate}.`)
      continue
    }
    if (!isSlotDate(sk, s.scheduledDate)) {
      issues.push(`${s.scheduledDate} is not one of the athlete's training days.`)
    }
    perDay.set(s.scheduledDate, (perDay.get(s.scheduledDate) ?? 0) + 1)
  }
  for (const [date, n] of perDay) {
    if (n > MAX_SESSIONS_PER_DAY) issues.push(`${date} has ${n} sessions (max ${MAX_SESSIONS_PER_DAY}).`)
  }

  const km = weeklyRunKm(plan, sk)
  sk.weeks.forEach((w, i) => {
    const end = addDays(w.weekStart, 6)
    if (w.full) {
      // Rest day: at least one of the 7 days has no session.
      let anyEmpty = false
      for (let d = 0; d < 7; d++) {
        if (!perDay.has(addDays(w.weekStart, d))) anyEmpty = true
      }
      if (!anyEmpty) issues.push(`Week of ${w.weekStart} has no rest day.`)
    }
    if (w.full && ['base', 'build', 'peak'].includes(w.phase) && w.slotDates.length >= 3) {
      const hasLong = plan.sessions.some(
        (s) =>
          s.scheduledDate >= w.weekStart &&
          s.scheduledDate <= end &&
          /long/i.test(s.sessionType)
      )
      if (!hasLong) issues.push(`Week of ${w.weekStart} has no long run.`)
    }
    if (km[i] > w.targetKm * TARGET_TOLERANCE + RAMP_SLACK_KM) {
      soft.push(
        `Week of ${w.weekStart} totals ${km[i].toFixed(1)} km, above the ${w.targetKm} km cap.`
      )
    }
    // Ramp: compare with the larger of the previous two full weeks (a recovery
    // week must not make the following week look like a >10% jump).
    if (w.full && i > 0 && sk.weeks[i - 1].full) {
      const prevTwo = [km[i - 1], i > 1 && sk.weeks[i - 2].full ? km[i - 2] : 0]
      const ref = Math.max(...prevTwo)
      if (ref > 0 && km[i] > ref * (1 + RAMP_RATE) + RAMP_SLACK_KM) {
        soft.push(
          `Week of ${w.weekStart} (${km[i].toFixed(1)} km) jumps more than ${Math.round(RAMP_RATE * 100)}% over ${ref.toFixed(1)} km.`
        )
      }
    }
  })

  return { hard: issues, soft }
}

/** A repair never cuts a week below this share of what the model wrote; a deeper cut means regenerate. */
export const MIN_REPAIR_SCALE = 0.6

export interface PlanRepair {
  plan: PlanDraft
  /** Human-readable, one per repaired week. */
  adjustments: string[]
  /** Short trace per session index (same order as plan.sessions); null when untouched. */
  sessionNotes: (string | null)[]
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Deterministic repair of weekly-volume violations. Walks the weeks forward and
 * scales a week's run distances (and durations, proportionally) DOWN so it meets
 * its cap; the ramp reference is the previous (possibly repaired) weeks.
 * Never scales up; one uniform factor per week keeps ratios, so the long run
 * stays the longest. A week needing a cut deeper than MIN_REPAIR_SCALE is left
 * as-is so validation still reports it.
 */
export function repairPlan(plan: PlanDraft, sk: Skeleton): PlanRepair {
  const sessions = plan.sessions.map((s) => ({ ...s }))
  const sessionNotes: (string | null)[] = sessions.map(() => null)
  const adjustments: string[] = []
  const km = weeklyRunKm({ ...plan, sessions }, sk)
  sk.weeks.forEach((w, i) => {
    const end = addDays(w.weekStart, 6)
    const capLimit = w.targetKm * TARGET_TOLERANCE
    let rampLimit = Infinity
    if (w.full && i > 0 && sk.weeks[i - 1].full) {
      const ref = Math.max(km[i - 1], i > 1 && sk.weeks[i - 2].full ? km[i - 2] : 0)
      if (ref > 0) rampLimit = ref * (1 + RAMP_RATE)
    }
    const overCap = km[i] > capLimit + RAMP_SLACK_KM
    const overRamp = km[i] > rampLimit + RAMP_SLACK_KM
    if (!overCap && !overRamp) return
    const limit = Math.min(capLimit, rampLimit)
    const factor = limit / km[i]
    if (!(factor >= MIN_REPAIR_SCALE) || factor >= 1) return
    const before = km[i]
    sessions.forEach((s, idx) => {
      if (!isRun(s.sportType) || s.scheduledDate < w.weekStart || s.scheduledDate > end) return
      if (s.targetDistanceM != null) s.targetDistanceM = Math.floor(s.targetDistanceM * factor)
      if (s.targetDurationS != null) s.targetDurationS = Math.floor(s.targetDurationS * factor)
      sessionNotes[idx] = `Distance reduced ${Math.round((1 - factor) * 100)}% automatically to keep the weekly volume within safe limits.`
    })
    km[i] = weeklyRunKm({ ...plan, sessions }, sk)[i]
    const reason =
      limit === rampLimit
        ? `to keep progression under ${Math.round(RAMP_RATE * 100)}%`
        : `to stay within the ${w.targetKm} km weekly target`
    adjustments.push(
      `Week of ${w.weekStart} reduced from ${before.toFixed(1)} km to ${round1(km[i]).toFixed(1)} km ${reason}`
    )
  })
  return { plan: { ...plan, sessions }, adjustments, sessionNotes }
}
