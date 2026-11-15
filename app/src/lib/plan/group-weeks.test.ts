import { describe, it, expect } from 'vitest'
import { groupByWeek, currentWeekIndex } from './group-weeks'

describe('groupByWeek', () => {
  const s = (d: string) => ({ scheduled_date: d })
  it('builds Monday-first 7-day weeks across the window', () => {
    const weeks = groupByWeek([s('2026-10-14'), s('2026-10-20')], '2026-10-14', '2026-10-25')
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-10-12', '2026-10-19'])
    expect(weeks[0].days).toHaveLength(7)
    expect(weeks[0].days[2].sessions).toHaveLength(1) // Wed 14
    expect(weeks[1].days[1].sessions).toHaveLength(1) // Tue 20
  })
  it('keeps a session outside the window visible', () => {
    const weeks = groupByWeek([s('2026-11-10')], '2026-10-14', '2026-10-25')
    expect(weeks[weeks.length - 1].weekStart).toBe('2026-11-09')
  })
  it('picks the week containing today, clamped to the plan', () => {
    const weeks = [{ weekStart: '2026-10-12' }, { weekStart: '2026-10-19' }]
    expect(currentWeekIndex(weeks, '2026-10-21')).toBe(1)
    expect(currentWeekIndex(weeks, '2026-09-01')).toBe(0)
    expect(currentWeekIndex(weeks, '2027-01-01')).toBe(1)
  })
})
