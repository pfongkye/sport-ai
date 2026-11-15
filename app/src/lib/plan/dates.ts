/**
 * Pure calendar-date helpers for the training plan. A planned session's
 * `scheduled_date` is a DATE (no time), so all arithmetic here works on
 * `YYYY-MM-DD` strings via UTC math and never depends on the server's timezone.
 * The only timezone-aware function is `localDateInTz`, which answers "what
 * calendar date is it for the athlete right now?".
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** True for a real calendar date in `YYYY-MM-DD` form (rejects 2026-02-31). */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** The athlete's calendar date for `now` in IANA timezone `tz` (UTC if `tz` is invalid). */
export function localDateInTz(now: Date, tz: string | null | undefined): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now)
    const get = (t: string) => parts.find((p) => p.type === t)?.value
    const y = get('year')
    const m = get('month')
    const d = get('day')
    if (y && m && d) return `${y}-${m}-${d}`
  } catch {
    // invalid tz → fall through to UTC
  }
  return now.toISOString().slice(0, 10)
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Whole days from `a` to `b` (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000
  )
}

/** Weekday index with Monday = 0 … Sunday = 6. */
export function weekdayIndex(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7
}

/** The Monday on or before `iso`. */
export function mondayOf(iso: string): string {
  return addDays(iso, -weekdayIndex(iso))
}

export const WEEKDAY_NAMES = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const
