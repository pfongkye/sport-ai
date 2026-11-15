import { describe, it, expect } from 'vitest'
import {
  buildSkeleton,
  computeWindow,
  normalizeTrainingDays,
  taperWeeksFor,
  SkeletonError,
  MAX_PLAN_WEEKS,
  DEFAULT_PLAN_WEEKS,
  MIN_START_KM,
} from './plan-skeleton'

const DAYS = ['monday', 'wednesday', 'friday', 'saturday']

describe('computeWindow', () => {
  it('defaults to a 12-week block starting today when there is no goal date', () => {
    const w = computeWindow('2026-10-12', null)
    expect(w).toEqual({ startDate: '2026-10-12', endDate: '2027-01-03', hasGoalDate: false })
    expect(DEFAULT_PLAN_WEEKS).toBe(12)
  })
  it('ends exactly on the goal date', () => {
    const w = computeWindow('2026-10-12', '2026-12-06')
    expect(w.startDate).toBe('2026-10-12')
    expect(w.endDate).toBe('2026-12-06')
  })
  it('caps a far goal at MAX_PLAN_WEEKS by starting later', () => {
    const w = computeWindow('2026-01-05', '2027-01-03')
    expect(w.endDate).toBe('2027-01-03')
    expect(w.startDate > '2026-01-05').toBe(true)
    const days = (Date.parse(w.endDate) - Date.parse(w.startDate)) / 86400000 + 1
    expect(days).toBe(MAX_PLAN_WEEKS * 7)
  })
  it('rejects an invalid or too-near goal date', () => {
    expect(() => computeWindow('2026-10-12', 'soon')).toThrow(SkeletonError)
    expect(() => computeWindow('2026-10-12', '2026-10-15')).toThrow(/at least/)
    expect(() => computeWindow('2026-10-12', '2026-10-01')).toThrow(SkeletonError)
  })
})

describe('taper + training days + baseline', () => {
  it('sizes the taper', () => {
    expect(taperWeeksFor(16, true)).toBe(2)
    expect(taperWeeksFor(6, true)).toBe(1)
    expect(taperWeeksFor(3, true)).toBe(0)
    expect(taperWeeksFor(16, false)).toBe(0)
  })
  it('maps training day names and falls back to a default', () => {
    expect(normalizeTrainingDays(['Saturday', 'monday', 'bogus'])).toEqual([0, 5])
    expect(normalizeTrainingDays([])).toEqual([0, 2, 4, 5])
    expect(normalizeTrainingDays(['bogus'])).toEqual([0, 2, 4, 5])
  })
})
describe('buildSkeleton', () => {
  const sk = buildSkeleton({
    today: '2026-10-12', // Monday
    goalDate: '2027-01-31', // Sunday, ~16 weeks
    trainingDays: DAYS,
    baselineWeeklyKm: 30,
  })

  it('covers the window with Monday-aligned weeks and only training-day slots', () => {
    expect(sk.startDate).toBe('2026-10-12')
    expect(sk.endDate).toBe('2027-01-31')
    expect(sk.totalWeeks).toBe(16)
    for (const w of sk.weeks) {
      expect(w.slotDates.every((d) => d >= sk.startDate && d <= sk.endDate)).toBe(true)
      expect(w.slotDates).toHaveLength(4)
      expect(w.full).toBe(true)
    }
  })

  it('tapers before the goal date', () => {
    expect(sk.taperWeeks).toBe(2)
    const last = sk.weeks.slice(-2)
    expect(last.every((w) => w.phase === 'taper')).toBe(true)
    const peak = Math.max(...sk.weeks.map((w) => w.targetKm))
    expect(last[0].targetKm).toBeLessThan(peak)
    expect(last[1].targetKm).toBeLessThan(last[0].targetKm)
  })

  it('never ramps more than ~10% week over week outside recovery/taper', () => {
    let lastLoad = 0
    for (const w of sk.weeks) {
      if (w.phase === 'recovery' || w.phase === 'taper') continue
      if (lastLoad) expect(w.targetKm).toBeLessThanOrEqual(+(lastLoad * 1.1).toFixed(1) + 0.1)
      lastLoad = w.targetKm
    }
  })

  it('inserts lighter recovery weeks and a peak before the taper', () => {
    const rec = sk.weeks.filter((w) => w.phase === 'recovery')
    expect(rec.length).toBeGreaterThan(0)
    const i = sk.weeks.indexOf(rec[0])
    expect(rec[0].targetKm).toBeLessThan(sk.weeks[i - 1].targetKm)
    expect(sk.weeks[sk.totalWeeks - sk.taperWeeks - 1].phase).toBe('peak')
  })

  it('starts from the baseline, floored only at the small MIN_START_KM sanity floor', () => {
    expect(sk.weeks[0].targetKm).toBe(30)
    const low = buildSkeleton({ today: '2026-10-12', goalDate: null, trainingDays: DAYS, baselineWeeklyKm: 0 })
    expect(low.weeks[0].targetKm).toBe(MIN_START_KM)
    expect(MIN_START_KM).toBeLessThan(15)
    const small = buildSkeleton({ today: '2026-10-12', goalDate: null, trainingDays: DAYS, baselineWeeklyKm: 9 })
    expect(small.weeks[0].targetKm).toBe(9) // no more flat 15 km floor
  })

  it('scales a partial first week and marks it not full', () => {
    const mid = buildSkeleton({
      today: '2026-10-15', // Thursday
      goalDate: '2026-12-13',
      trainingDays: DAYS,
      baselineWeeklyKm: 40,
    })
    const first = mid.weeks[0]
    expect(first.slotDates).toEqual(['2026-10-16', '2026-10-17'])
    expect(first.full).toBe(false)
    expect(first.targetKm).toBe(20)
  })

  it('has no taper without a goal date', () => {
    const g = buildSkeleton({ today: '2026-10-12', goalDate: null, trainingDays: DAYS, baselineWeeklyKm: 20 })
    expect(g.taperWeeks).toBe(0)
    expect(g.weeks.some((w) => w.phase === 'taper')).toBe(false)
  })
})
