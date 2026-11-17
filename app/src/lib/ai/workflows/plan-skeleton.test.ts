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
  isSlotDate,
  raceDayBefore,
} from './plan-skeleton'
import { resolveLimits, STANDARD_DISTANCE_KM, type RaceGoal } from '@/lib/plan/race-goal'

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

describe('buildSkeleton with a race', () => {
  const race = (distance: '5k' | '10k' | 'half' | 'marathon'): RaceGoal => ({
    distance,
    distanceKm: STANDARD_DISTANCE_KM[distance],
    targetTimeS: null,
  })
  const build = (over: { goalDate: string; days?: string[]; baseline?: number; r?: RaceGoal; today?: string; limits?: ReturnType<typeof resolveLimits> }) => {
    const r = over.r ?? race('10k')
    return buildSkeleton({
      today: over.today ?? '2026-10-12',
      goalDate: over.goalDate,
      trainingDays: over.days ?? DAYS,
      baselineWeeklyKm: over.baseline ?? 30,
      race: r,
      limits: over.limits ?? resolveLimits(r, null),
    })
  }
  const SUNDAY = '2027-03-21'
  const MONDAY = '2027-03-22'

  it('makes a Sunday race a slot of the last week even when Sunday is not a training day', () => {
    const sk = build({ goalDate: SUNDAY })
    const last = sk.weeks[sk.weeks.length - 1]
    expect(last.phase).toBe('race')
    expect(last.slotDates).toContain(SUNDAY)
    expect(last.slotDates[last.slotDates.length - 1]).toBe(SUNDAY)
    expect(isSlotDate(sk, SUNDAY)).toBe(true)
    expect(isSlotDate(sk, '2027-03-14')).toBe(false) // an ordinary Sunday
    expect(sk.race).toEqual({ date: SUNDAY, distanceKm: 10, targetTimeS: null })
    expect(raceDayBefore(sk)).toBe('2027-03-20')
  })

  it('keeps the race date a slot when its weekday is unavailable', () => {
    const sk = build({ goalDate: SUNDAY, days: ['monday', 'wednesday', 'friday', 'sunday'].filter((d) => d !== 'sunday') })
    expect(isSlotDate(sk, SUNDAY)).toBe(true)
    // Race on a Wednesday that was removed from the training days.
    const wed = build({ goalDate: '2027-03-24', days: ['monday', 'friday', 'saturday'] })
    expect(wed.weeks[wed.weeks.length - 1].slotDates).toContain('2027-03-24')
    expect(wed.weeks[wed.weeks.length - 1].phase).toBe('race')
  })

  it('sizes the race week as race plus a short shake-out, with no long run', () => {
    const sk = build({ goalDate: SUNDAY })
    const last = sk.weeks[sk.weeks.length - 1]
    expect(last.longRunKm).toBe(0)
    expect(last.maxLongRunKm).toBe(6)
    const peak = Math.max(...sk.weeks.filter((w) => w.phase !== 'race').map((w) => w.targetKm))
    expect(last.targetKm).toBeGreaterThan(10)
    expect(last.targetKm).toBeLessThanOrEqual(10 + 12)
    expect(peak).toBeGreaterThan(0)
  })

  it.each([
    ['5k', SUNDAY, 0],
    ['5k', MONDAY, 1],
    ['10k', SUNDAY, 1],
    ['10k', MONDAY, 2],
    ['half', SUNDAY, 1],
    ['half', MONDAY, 2],
    ['marathon', SUNDAY, 2],
    ['marathon', MONDAY, 3],
  ] as const)('tapers a %s race on %s for %i week(s)', (d, date, weeks) => {
    const sk = build({ goalDate: date, r: race(d) })
    expect(sk.taperWeeks).toBe(weeks)
    const tapers = sk.weeks.filter((w) => w.phase === 'taper')
    expect(tapers).toHaveLength(weeks)
    expect(sk.weeks[sk.weeks.length - 1].phase).toBe('race')
    const before = sk.weeks[sk.weeks.length - 2 - weeks]
    expect(before.phase).toBe('peak')
    tapers.forEach((t) => expect(t.targetKm).toBeLessThan(before.targetKm))
  })

  it('always keeps a build week and never more than 3 taper weeks', () => {
    const short = build({ goalDate: '2026-10-25', r: race('marathon') }) // 2 weeks
    expect(short.taperWeeks).toBe(0)
    expect(short.weeks.map((w) => w.phase)).toEqual(['base', 'race'])
    const long = build({ goalDate: SUNDAY, r: race('marathon'), limits: resolveLimits(race('marathon'), { taperDays: 21 }) })
    expect(long.taperWeeks).toBe(3)
  })

  it('caps a marathon-sized baseline at the 10 km limits over a 24-week plan', () => {
    const sk = build({ goalDate: SUNDAY, baseline: 70, today: '2026-09-14' })
    expect(sk.totalWeeks).toBe(MAX_PLAN_WEEKS)
    for (const w of sk.weeks) {
      expect(w.targetKm).toBeLessThanOrEqual(55 + 10 + 12) // race week adds the race itself
      if (w.phase !== 'race') expect(w.targetKm).toBeLessThanOrEqual(55)
      expect(w.maxLongRunKm).toBeLessThanOrEqual(18)
      expect(w.longRunKm).toBeLessThanOrEqual(w.maxLongRunKm)
    }
    expect(sk.weeks[0].targetKm).toBe(55)
  })

  it('uses clamped overrides', () => {
    const r = race('10k')
    const sk = build({ goalDate: SUNDAY, baseline: 70, limits: resolveLimits(r, { maxWeeklyKm: 30, maxLongRunKm: 1 }) })
    expect(sk.limits.maxWeeklyKm).toBe(30)
    expect(sk.limits.maxLongRunKm).toBe(7) // clamped up to 0.4 x 18
    expect(Math.max(...sk.weeks.filter((w) => w.phase !== 'race').map((w) => w.targetKm))).toBeLessThanOrEqual(30)
    expect(Math.max(...sk.weeks.map((w) => w.maxLongRunKm))).toBeLessThanOrEqual(7)
  })

  it('behaves as before without a race (general limits, legacy taper)', () => {
    const g = buildSkeleton({ today: '2026-10-12', goalDate: '2027-01-31', trainingDays: DAYS, baselineWeeklyKm: 30 })
    expect(g.race).toBeNull()
    expect(g.limits.maxWeeklyKm).toBe(110)
    expect(g.limits.maxLongRunKm).toBe(32)
    expect(g.taperWeeks).toBe(2)
    expect(g.weeks.some((w) => w.phase === 'race')).toBe(false)
    expect(isSlotDate(g, '2027-01-31')).toBe(false) // Sunday is not a training day
    expect(raceDayBefore(g)).toBeNull()
  })
})

describe('longest-run cap for weeks with 1-2 training days', () => {
  it('lets each run of a 2-day week reach its share of the week, with or without a race', () => {
    const days = ['tuesday', 'saturday']
    const noRace = buildSkeleton({ today: '2026-10-12', goalDate: null, trainingDays: days, baselineWeeklyKm: 20 })
    const r: RaceGoal = { distance: '10k', distanceKm: 10, targetTimeS: null }
    const withRace = buildSkeleton({
      today: '2026-10-12',
      goalDate: '2027-01-03',
      trainingDays: days,
      baselineWeeklyKm: 20,
      race: r,
      limits: resolveLimits(r, null),
    })
    for (const sk of [noRace, withRace]) {
      for (const w of sk.weeks.filter((x) => x.full && x.phase !== 'race')) {
        expect(w.maxLongRunKm).toBeGreaterThanOrEqual(Math.min((w.targetKm / 2) * 1.2, sk.limits.maxLongRunKm) - 0.1)
        expect(w.maxLongRunKm).toBeLessThanOrEqual(sk.limits.maxLongRunKm)
      }
    }
  })
})

describe('Monday race taper', () => {
  it('has one more taper week than a Sunday race (taper is counted by week-end date)', () => {
    const r: RaceGoal = { distance: 'marathon', distanceKm: 42.195, targetTimeS: null }
    const mk = (goalDate: string) =>
      buildSkeleton({ today: '2026-10-12', goalDate, trainingDays: DAYS, baselineWeeklyKm: 40, race: r, limits: resolveLimits(r, null) })
    expect(mk('2027-03-21').taperWeeks).toBe(2) // Sunday
    expect(mk('2027-03-22').taperWeeks).toBe(3) // Monday
  })
})

