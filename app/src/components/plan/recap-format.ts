import { formatPace } from '@/lib/utils'
import type { TrainingRecap } from '@/lib/ai/workflows/training-recap'
import { weekLabel } from './plan-format'
import { addDays } from '@/lib/plan/dates'

export interface RecapWeekView {
  key: string
  label: string
  used: boolean
  /** "32.4 km · 3 runs" for used weeks, the exclusion reason otherwise. */
  detail: string
}

export interface RecapView {
  summary: string
  weeks: RecapWeekView[]
  facts: { label: string; value: string }[]
  notes: string[]
}

const pct = (n: number) => `${Math.round(n * 100)}%`
const pace = (s: number | null) => (s == null ? 'Not available' : formatPace(s))

/** Pure view model for the "What your plan is based on" section. Metric only (no units setting is read in the plan UI). */
export function buildRecapView(recap: TrainingRecap): RecapView {
  const weeks = recap.weeks.map((w) => ({
    key: w.weekStart,
    label: weekLabel(w.weekStart, addDays(w.weekStart, 6)),
    used: w.qualifies,
    detail: w.qualifies
      ? `${w.runKm} km · ${w.runCount} ${w.runCount === 1 ? 'run' : 'runs'}${w.capped ? ' (capped as an outlier)' : ''}`
      : `Not used: ${w.reason}`,
  }))
  const t = recap.typical
  const facts = [
    {
      label: 'Starting weekly volume',
      value: `${recap.baseline.weeklyKm} km (${recap.baseline.source === 'history' ? 'from your recent weeks' : 'estimated from your training days'})`,
    },
    { label: 'Typical easy pace', value: pace(t.easyPaceSPerKm) },
    {
      label: 'Typical long run',
      value: t.longRunKm != null ? `${t.longRunKm} km at ${pace(t.longRunPaceSPerKm)}` : 'Not available',
    },
    {
      label: 'Intensity split',
      value: recap.intensity
        ? `${pct(recap.intensity.easy)} easy, ${pct(recap.intensity.moderate)} moderate, ${pct(recap.intensity.hard)} hard`
        : 'Not available',
    },
    ...(recap.trend ? [{ label: 'Trend', value: `${recap.trend.direction} (${recap.trend.changePct}% vs older weeks)` }] : []),
  ]
  return {
    summary: `${recap.qualifyingWeeks} of ${recap.weeks.length} recent weeks used${recap.sparse ? ' (limited history, so the plan starts conservatively)' : ''}`,
    weeks,
    facts,
    notes: recap.dataQuality.notes,
  }
}
