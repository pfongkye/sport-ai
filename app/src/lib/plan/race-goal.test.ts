import { describe, it, expect } from 'vitest'
import {
  DISTANCE_PROFILES,
  formatTargetTime,
  goalPaceLabel,
  parseLimitOverrides,
  parseRaceGoal,
  raceWeekRunCapKm,
  resolveLimits,
  type RaceGoal,
} from './race-goal'

const race = (distance: RaceGoal['distance'], distanceKm: number): RaceGoal => ({ distance, distanceKm, targetTimeS: null })

describe('resolveLimits defaults', () => {
  it('matches the per-distance table', () => {
    const rows: [RaceGoal | null, number, number, number, number][] = [
      [race('5k', 5), 50, 14, 0.35, 5],
      [race('10k', 10), 55, 18, 0.35, 8],
      [race('half', 21.0975), 70, 22, 0.35, 12],
      [race('marathon', 42.195), 100, 32, 0.35, 18],
      [race('other', 50), 110, 40, 0.4, 18],
      [race('other', 4), 50, 14, 0.35, 5],
      [race('other', 10), 55, 18, 0.35, 8],
      [race('other', 15), 70, 22, 0.35, 12],
      [race('other', 30), 100, 32, 0.35, 18],
      [null, 110, 32, 0.35, 0],
    ]
    for (const [r, weekly, long, share, taper] of rows) {
      const l = resolveLimits(r, null)
      expect([l.maxWeeklyKm, l.maxLongRunKm, l.longRunShare, l.taperDays]).toEqual([weekly, long, share, taper])
    }
    expect(DISTANCE_PROFILES['10k'].maxWeeklyKm).toBe(55)
  })

  it('has a race week cap of 60% of the race clamped to 3..8 km', () => {
    expect(raceWeekRunCapKm(5)).toBe(3)
    expect(raceWeekRunCapKm(10)).toBe(6)
    expect(raceWeekRunCapKm(42.195)).toBe(8)
    expect(resolveLimits(race('10k', 10), null).raceWeekRunCapKm).toBe(6)
    expect(resolveLimits(null, null).raceWeekRunCapKm).toBeNull()
  })
})

describe('resolveLimits overrides', () => {
  it('uses the override inside the band and the default for null/undefined', () => {
    const l = resolveLimits(race('10k', 10), { maxWeeklyKm: 40, maxLongRunKm: null })
    expect(l.maxWeeklyKm).toBe(40)
    expect(l.maxLongRunKm).toBe(18)
    expect(l.taperDays).toBe(8)
  })

  it('clamps to [0.4 x default, 1.3 x default] and the absolute maxima', () => {
    const l = resolveLimits(race('10k', 10), { maxWeeklyKm: 500, maxLongRunKm: 1, taperDays: 99 })
    expect(l.maxWeeklyKm).toBe(72)
    expect(l.maxLongRunKm).toBe(7)
    expect(l.taperDays).toBe(21)
    expect(l.bounds.maxWeeklyKm).toEqual([22, 72])
    const m = resolveLimits(race('marathon', 42.195), { maxWeeklyKm: 500, maxLongRunKm: 500 })
    expect(m.maxWeeklyKm).toBe(110)
    expect(m.maxLongRunKm).toBe(42)
    const u = resolveLimits(race('other', 80), { maxLongRunKm: 500 })
    expect(u.maxLongRunKm).toBe(50)
    expect(resolveLimits(race('10k', 10), { taperDays: 0 }).taperDays).toBe(0)
  })
})

describe('parseRaceGoal', () => {
  it('treats null as no race and accepts the standard distances with exact km', () => {
    expect(parseRaceGoal(null)).toEqual({ ok: true, value: null })
    expect(parseRaceGoal({ distance: 'half' })).toEqual({
      ok: true,
      value: { distance: 'half', distanceKm: 21.0975, targetTimeS: null },
    })
  })

  it('ignores a supplied distanceKm for standard distances', () => {
    const r = parseRaceGoal({ distance: '10k', distanceKm: 42 })
    expect(r.ok && r.value?.distanceKm).toBe(10)
  })

  it('rejects unknown distances and other without a usable km', () => {
    expect(parseRaceGoal({ distance: '7k' }).ok).toBe(false)
    expect(parseRaceGoal({ distance: 'other' }).ok).toBe(false)
    expect(parseRaceGoal({ distance: 'other', distanceKm: 2 }).ok).toBe(false)
    expect(parseRaceGoal({ distance: 'other', distanceKm: 101 }).ok).toBe(false)
    expect(parseRaceGoal({ distance: 'other', distanceKm: '12' }).ok).toBe(false)
    expect(parseRaceGoal({ distance: 'other', distanceKm: 12.5 }).ok).toBe(true)
    expect(parseRaceGoal('10k').ok).toBe(false)
  })

  it('validates the target time as whole seconds with a plausible pace', () => {
    expect(parseRaceGoal({ distance: '10k', targetTimeS: 2400 }).ok).toBe(true)
    expect(parseRaceGoal({ distance: '10k', targetTimeS: 2400.5 }).ok).toBe(false)
    expect(parseRaceGoal({ distance: '10k', targetTimeS: '2400' }).ok).toBe(false)
    expect(parseRaceGoal({ distance: '10k', targetTimeS: 600 }).ok).toBe(false) // 1:00/km
    expect(parseRaceGoal({ distance: '10k', targetTimeS: 20000 }).ok).toBe(false) // 33:20/km
    expect(parseRaceGoal({ distance: '10k', targetTimeS: 1200 }).ok).toBe(true) // 2:00/km edge
    expect(parseRaceGoal({ distance: '10k', targetTimeS: 12000 }).ok).toBe(true) // 20:00/km edge
  })
})

describe('parseLimitOverrides', () => {
  it('returns null for empty input and keeps given numbers', () => {
    expect(parseLimitOverrides(null)).toEqual({ ok: true, value: null })
    expect(parseLimitOverrides({ maxWeeklyKm: null })).toEqual({ ok: true, value: null })
    expect(parseLimitOverrides({ maxWeeklyKm: 40, taperDays: 0 })).toEqual({
      ok: true,
      value: { maxWeeklyKm: 40, taperDays: 0 },
    })
  })

  it('rejects non-numbers, negatives and zero km', () => {
    expect(parseLimitOverrides({ maxWeeklyKm: '40' }).ok).toBe(false)
    expect(parseLimitOverrides({ maxLongRunKm: 0 }).ok).toBe(false)
    expect(parseLimitOverrides({ taperDays: -1 }).ok).toBe(false)
    expect(parseLimitOverrides([]).ok).toBe(false)
  })
})

describe('formatting', () => {
  it('formats times and pace', () => {
    expect(formatTargetTime(2400)).toBe('40:00')
    expect(formatTargetTime(12600)).toBe('3:30:00')
    expect(goalPaceLabel(2400, 10)).toBe('4:00')
  })
})
