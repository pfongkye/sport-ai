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

/** Offset (ms) of `tz` from UTC at `instant`: local wall clock minus UTC. */
function tzOffsetMs(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant))
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'))
  return asUtc - Math.floor(instant / 1000) * 1000
}

function localMidnightMs(date: string, tz: string): number {
  const guess = new Date(`${date}T00:00:00Z`).getTime()
  const first = guess - tzOffsetMs(guess, tz)
  const second = guess - tzOffsetMs(first, tz)
  return second
}

/**
 * `[startSec, endSec)` in epoch seconds of the athlete's local calendar day
 * `date` in `tz`. DST-safe: a 23 or 25 hour day yields the real span. An
 * invalid `tz` falls back to UTC.
 */
export function dayBoundsEpoch(date: string, tz: string | null | undefined): [number, number] {
  let zone = tz || 'UTC'
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
  } catch {
    zone = 'UTC'
  }
  return [
    Math.floor(localMidnightMs(date, zone) / 1000),
    Math.floor(localMidnightMs(addDays(date, 1), zone) / 1000),
  ]
}
