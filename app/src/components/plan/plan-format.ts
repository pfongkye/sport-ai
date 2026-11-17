import { formatDistance, formatDuration } from '@/lib/utils'
import { diffDays } from '@/lib/plan/dates'
import { MIN_GOAL_LEAD_DAYS } from '@/lib/ai/workflows/plan-skeleton'

/** Race date to pre-fill when regenerating: the old end date, unless it is too close or past (submit would fail). */
export function prefillGoalDate(endDate: string, today: string): string {
  return diffDays(today, endDate) >= MIN_GOAL_LEAD_DAYS ? endDate : ''
}

/** `2026-10-12` → "Mon 12 Oct". UTC-based so the label never shifts with the viewer's timezone. */
export function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function weekLabel(weekStart: string, weekEnd: string): string {
  const f = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
    })
  return `${f(weekStart)} – ${f(weekEnd)}`
}

/** "10.00 km · 55m · Zone 2" for a session's targets (empty string when none). */
export function targetSummary(s: {
  target_distance_m: number | null
  target_duration_s: number | null
  target_hr_zone: number | null
}): string {
  const parts: string[] = []
  if (s.target_distance_m) parts.push(formatDistance(s.target_distance_m))
  if (s.target_duration_s) parts.push(formatDuration(s.target_duration_s))
  if (s.target_hr_zone) parts.push(`Zone ${s.target_hr_zone}`)
  return parts.join(' · ')
}
