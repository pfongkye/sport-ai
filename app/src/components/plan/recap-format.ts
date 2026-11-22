import { formatPace } from '@/lib/utils'
import type { TrainingRecap } from '@/lib/ai/workflows/training-recap'
import { weekLabel } from './plan-format'
import { addDays } from '@/lib/plan/dates'
import { makeT, type TFunction } from '@/lib/i18n/translate'
import type { Locale } from '@/lib/i18n/locales'

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

/**
 * The recap is stored with English reason/note strings written by the server. Known ones are
 * translated here by pattern; anything else is shown as stored.
 */
function reasonText(reason: string, t: TFunction): string {
  if (reason === 'no activity') return t('recap.reasonNoActivity')
  const m = /^(\d+) activity \(minimum (\d+)\)$/.exec(reason)
  return m ? t('recap.reasonMinActivities', { n: m[1], min: m[2] }) : reason
}

function noteText(note: string, t: TFunction): string {
  let m: RegExpExecArray | null
  if ((m = /^(\d+)% of runs have no heart rate$/.exec(note))) return t('recap.noteNoHr', { pct: m[1] })
  if ((m = /^(\d+)% of runs have no usable pace$/.exec(note))) return t('recap.noteNoPace', { pct: m[1] })
  if ((m = /^(\d+)% of runs have no distance/.exec(note))) return t('recap.noteNoDistance', { pct: m[1] })
  if (note.startsWith('Max heart rate estimated as 220')) return t('recap.noteMaxHrAge')
  if (note === 'Max heart rate unknown, so no intensity split') return t('recap.noteMaxHrUnknown')
  if (note.startsWith('A very large week was capped')) return t('recap.noteCapped')
  if (note.startsWith('No qualifying weeks')) return t('recap.noteNoWeeks')
  return note
}

/** Pure view model for the "What your plan is based on" section. Metric only (no units setting is read in the plan UI). */
export function buildRecapView(recap: TrainingRecap, locale: Locale = 'en'): RecapView {
  const t = makeT(locale)
  // Values are already rounded to 1 decimal; only the decimal separator depends on the language.
  const km = (n: number) => (locale === 'fr' ? String(n).replace('.', ',') : String(n))
  const pace = (s: number | null) => (s == null ? t('recap.notAvailable') : formatPace(s))
  const weeks = recap.weeks.map((w) => ({
    key: w.weekStart,
    label: weekLabel(w.weekStart, addDays(w.weekStart, 6), locale),
    used: w.qualifies,
    detail: w.qualifies
      ? t(w.runCount === 1 ? 'recap.runOne' : 'recap.runMany', { km: km(w.runKm), n: w.runCount }) +
        (w.capped ? t('recap.capped') : '')
      : t('recap.notUsed', { reason: reasonText(w.reason ?? '', t) }),
  }))
  const typ = recap.typical
  const facts = [
    {
      label: t('recap.startVolume'),
      value: `${km(recap.baseline.weeklyKm)} km (${recap.baseline.source === 'history' ? t('recap.fromHistory') : t('recap.estimated')})`,
    },
    { label: t('recap.easyPace'), value: pace(typ.easyPaceSPerKm) },
    {
      label: t('recap.longRun'),
      value:
        typ.longRunKm != null
          ? t('recap.longRunAt', { km: km(typ.longRunKm), pace: pace(typ.longRunPaceSPerKm) })
          : t('recap.notAvailable'),
    },
    {
      label: t('recap.intensity'),
      value: recap.intensity
        ? t('recap.intensityValue', {
            easy: pct(recap.intensity.easy),
            moderate: pct(recap.intensity.moderate),
            hard: pct(recap.intensity.hard),
          })
        : t('recap.notAvailable'),
    },
    ...(recap.trend
      ? [
          {
            label: t('recap.trend'),
            value: t('recap.trendValue', {
              direction: t(
                recap.trend.direction === 'up'
                  ? 'recap.trendUp'
                  : recap.trend.direction === 'down'
                    ? 'recap.trendDown'
                    : 'recap.trendStable'
              ),
              pct: recap.trend.changePct,
            }),
          },
        ]
      : []),
  ]
  return {
    summary:
      t('recap.summary', { used: recap.qualifyingWeeks, total: recap.weeks.length }) +
      (recap.sparse ? t('recap.sparse') : ''),
    weeks,
    facts,
    notes: recap.dataQuality.notes.map((n) => noteText(n, t)),
  }
}
