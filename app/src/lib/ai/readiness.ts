import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { ReadinessResult } from '@/types/activity'

/**
 * Compute a training readiness snapshot from the last 42 days of activities.
 *
 * Uses the standard ATL/CTL/TSB (acute/chronic load, form) model, but with two
 * important corrections for real-world sparse data:
 *
 * 1. Sparse-data guard: readiness models need weeks of consistent training to
 *    mean anything. With only a handful of sessions (little chronic base), a
 *    single recent run makes ATL spike above CTL and produces a spuriously
 *    "very fatigued" score. When there isn't enough history, we report a
 *    neutral-to-fresh score rather than alarming fatigue.
 *
 * 2. Calibrated scaling: TSB is normalised against the athlete's own chronic
 *    load (CTL) instead of a fixed multiplier, so the score reflects fatigue
 *    RELATIVE to what they're used to — and clamps sensibly.
 */
export async function computeReadiness(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<ReadinessResult | null> {
  const since = new Date()
  since.setDate(since.getDate() - 42)

  const { data } = await supabase
    .from('activities')
    .select('started_at, training_load')
    .eq('user_id', userId)
    .gte('started_at', since.toISOString())

  const activities = data ?? []
  if (!activities.length) return null

  // Daily total load
  const dailyLoad: Record<string, number> = {}
  let sessionCount = 0
  for (const a of activities) {
    const day = a.started_at.slice(0, 10)
    dailyLoad[day] = (dailyLoad[day] ?? 0) + (a.training_load ?? 0)
    sessionCount++
  }

  // EWMA over 42 days
  const atlDecay = 1 - Math.exp(-1 / 7)
  const ctlDecay = 1 - Math.exp(-1 / 42)
  let atl = 0
  let ctl = 0
  for (let i = 41; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const load = dailyLoad[d.toISOString().slice(0, 10)] ?? 0
    atl += atlDecay * (load - atl)
    ctl += ctlDecay * (load - ctl)
  }

  const tsb = ctl - atl
  const round = (n: number) => +n.toFixed(1)

  // ── Sparse-data guard ──────────────────────────────────────────────────────
  // Fewer than ~6 sessions in 42 days, or a negligible chronic base, means we
  // don't have enough signal to diagnose fatigue. Report fresh/optimal and say
  // why, rather than a scary 0/100.
  const daysSpan = spanDays(activities)
  const enoughData = sessionCount >= 6 && ctl >= 5 && daysSpan >= 10
  if (!enoughData) {
    return {
      atl: round(atl),
      ctl: round(ctl),
      tsb: round(tsb),
      score: 80,
      label: 'Fresh',
      message:
        'Not enough training history yet to gauge fatigue precisely — treating you as fresh. Log a couple more weeks of sessions for accurate readiness.',
    }
  }

  // ── Calibrated score ───────────────────────────────────────────────────────
  // Normalise TSB by chronic load so it reflects fatigue relative to the
  // athlete's own norm. ratio in ~[-1, +1]; map to 0-100 centred at 65.
  const ratio = Math.max(-1, Math.min(1, tsb / Math.max(ctl, 1)))
  const score = Math.round(Math.max(0, Math.min(100, 65 + ratio * 35)))

  const label: ReadinessResult['label'] =
    score >= 75 ? 'Fresh' : score >= 55 ? 'Optimal' : score >= 35 ? 'Tired' : 'Very Fatigued'
  const message =
    score >= 75
      ? 'Well rested — good day for quality work.'
      : score >= 55
        ? 'Balanced load — you can train normally.'
        : score >= 35
          ? 'Carrying some fatigue — keep it easy or add recovery.'
          : 'High fatigue — prioritise recovery.'

  return { atl: round(atl), ctl: round(ctl), tsb: round(tsb), score, label, message }
}

/** Days between the earliest and latest activity in the set. */
function spanDays(activities: { started_at: string }[]): number {
  if (activities.length < 2) return 0
  const times = activities.map((a) => new Date(a.started_at).getTime())
  return (Math.max(...times) - Math.min(...times)) / 86400000
}
