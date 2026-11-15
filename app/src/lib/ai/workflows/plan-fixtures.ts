import { buildSkeleton, type Skeleton } from './plan-skeleton'
import type { PlanDraft } from './plan-schema'

export const TRAINING_DAYS = ['monday', 'wednesday', 'friday', 'saturday']

export function makeSkeleton(over: { goalDate?: string | null; today?: string; baseline?: number } = {}): Skeleton {
  return buildSkeleton({
    today: over.today ?? '2026-10-12',
    goalDate: over.goalDate === undefined ? '2026-12-06' : over.goalDate,
    trainingDays: TRAINING_DAYS,
    baselineWeeklyKm: over.baseline ?? 30,
  })
}

/** A plan that follows the skeleton exactly: easy runs + one long run per week at ~target km. */
export function validPlanFor(sk: Skeleton): PlanDraft {
  const sessions: PlanDraft['sessions'] = []
  for (const w of sk.weeks) {
    const n = w.slotDates.length
    w.slotDates.forEach((date, i) => {
      const isLong = i === n - 1 && w.longRunKm > 0
      const km = isLong ? w.longRunKm : (w.targetKm - (w.longRunKm || 0)) / Math.max(n - (w.longRunKm ? 1 : 0), 1)
      sessions.push({
        scheduledDate: date,
        sportType: 'run',
        sessionType: isLong ? 'long run' : 'easy',
        description: 'Steady effort.',
        targetDistanceM: Math.round(km * 1000 * 0.98),
        targetDurationS: null,
        targetHrZone: 2,
      })
    })
  }
  return { title: 'Marathon plan', goal: 'Marathon 3h30', startDate: sk.startDate, endDate: sk.endDate, sessions }
}

/** A plan whose run sessions are scaled so each skeleton week totals `km[i]` (long run is the biggest session). */
export function planWithWeeklyKm(sk: Skeleton, km: number[]): PlanDraft {
  const plan = validPlanFor(sk)
  sk.weeks.forEach((w, i) => {
    const inWeek = plan.sessions.filter((s) => w.slotDates.includes(s.scheduledDate))
    const total = inWeek.reduce((a, s) => a + (s.targetDistanceM ?? 0), 0)
    const f = total > 0 ? (km[i] * 1000) / total : 0
    for (const s of inWeek) {
      s.targetDistanceM = Math.round((s.targetDistanceM ?? 0) * f)
      s.targetDurationS = Math.round((s.targetDistanceM ?? 0) * 0.33)
    }
  })
  return plan
}
