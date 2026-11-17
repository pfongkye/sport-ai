import { describe, it, expect, afterEach, vi } from 'vitest'
import { dayLabel, prefillGoalDate, weekLabel } from './plan-format'

describe('plan date labels never shift with the viewer zone', () => {
  const original = process.env.TZ
  afterEach(() => {
    process.env.TZ = original
    vi.resetModules()
  })
  it('formats a plain date as the same day for a negative-offset runtime zone', () => {
    process.env.TZ = 'Pacific/Honolulu'
    expect(dayLabel('2026-10-12')).toBe('Mon 12 Oct')
    expect(weekLabel('2026-10-12', '2026-10-18')).toBe('12 Oct – 18 Oct')
  })
  it('formats the same for a positive-offset runtime zone', () => {
    process.env.TZ = 'Pacific/Auckland'
    expect(dayLabel('2026-10-12')).toBe('Mon 12 Oct')
  })
})

describe('prefillGoalDate', () => {
  it('keeps a race date at least 7 days away', () => {
    expect(prefillGoalDate('2026-12-06', '2026-11-29')).toBe('2026-12-06')
  })
  it('clears a race date that is past or within 7 days (submit would be GOAL_TOO_SOON)', () => {
    expect(prefillGoalDate('2026-12-06', '2026-12-07')).toBe('')
    expect(prefillGoalDate('2026-12-06', '2026-11-30')).toBe('')
  })
})
