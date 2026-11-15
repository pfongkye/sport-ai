import { addDays, mondayOf } from './dates'

export interface DayBucket<T> {
  date: string
  sessions: T[]
}

export interface WeekBucket<T> {
  /** Monday of the week. */
  weekStart: string
  days: DayBucket<T>[]
}

/**
 * Group sessions into Monday-first weeks covering [startDate, endDate]. Every
 * week has all 7 day slots (rest days are just empty), so the UI can render a
 * stable week grid. Sessions outside the window still get their own week so
 * nothing is silently hidden (e.g. after a manual move).
 */
export function groupByWeek<T extends { scheduled_date: string }>(
  sessions: T[],
  startDate: string,
  endDate: string
): WeekBucket<T>[] {
  const first = sessions.length ? [startDate, ...sessions.map((s) => s.scheduled_date)].sort()[0] : startDate
  const last = sessions.length
    ? [endDate, ...sessions.map((s) => s.scheduled_date)].sort().slice(-1)[0]
    : endDate
  const weeks: WeekBucket<T>[] = []
  for (let ws = mondayOf(first); ws <= last; ws = addDays(ws, 7)) {
    const days: DayBucket<T>[] = []
    for (let d = 0; d < 7; d++) {
      const date = addDays(ws, d)
      days.push({ date, sessions: sessions.filter((s) => s.scheduled_date === date) })
    }
    weeks.push({ weekStart: ws, days })
  }
  return weeks
}

/** Index of the week to show first: the one containing `today`, clamped to the plan. */
export function currentWeekIndex(weeks: { weekStart: string }[], today: string): number {
  if (!weeks.length) return 0
  const monday = mondayOf(today)
  const i = weeks.findIndex((w) => w.weekStart === monday)
  if (i >= 0) return i
  return monday < weeks[0].weekStart ? 0 : weeks.length - 1
}
