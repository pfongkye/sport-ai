import { formatDistance, formatDuration } from '@/lib/utils'
import { diffDays } from '@/lib/plan/dates'
import { MIN_GOAL_LEAD_DAYS } from '@/lib/ai/workflows/plan-skeleton'
import { intlLocale, type Locale } from '@/lib/i18n/locales'
import { makeT } from '@/lib/i18n/translate'

/** Race date to pre-fill when regenerating: the old end date, unless it is too close or past (submit would fail). */
export function prefillGoalDate(endDate: string, today: string): string {
  return diffDays(today, endDate) >= MIN_GOAL_LEAD_DAYS ? endDate : ''
}

/** `2026-10-12` → "Mon 12 Oct". UTC-based so the label never shifts with the viewer's timezone. */
export function dayLabel(iso: string, locale: Locale = 'en'): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(intlLocale(locale), {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function weekLabel(weekStart: string, weekEnd: string, locale: Locale = 'en'): string {
  const f = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(intlLocale(locale), {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
    })
  return `${f(weekStart)} – ${f(weekEnd)}`
}

/** "10.00 km · 55m · Zone 2" for a session's targets (empty string when none). */
export function targetSummary(
  s: {
    target_distance_m: number | null
    target_duration_s: number | null
    target_hr_zone: number | null
  },
  locale: Locale = 'en'
): string {
  const parts: string[] = []
  if (s.target_distance_m) parts.push(formatDistance(s.target_distance_m, 'metric', locale))
  if (s.target_duration_s) parts.push(formatDuration(s.target_duration_s))
  if (s.target_hr_zone) parts.push(makeT(locale)('plan.zone', { n: s.target_hr_zone }))
  return parts.join(' · ')
}

/** Weekday name for an index into WEEKDAY_NAMES (0 = monday), in the active language. Jan 5 2026 is a Monday. */
export function weekdayName(index: number, locale: Locale = 'en', style: 'long' | 'short' = 'long'): string {
  return new Date(Date.UTC(2026, 0, 5 + index)).toLocaleDateString(intlLocale(locale), {
    timeZone: 'UTC',
    weekday: style,
  })
}
