import { describe, it, expect } from 'vitest'
import {
  computeTrainingRecap,
  fallbackWeeklyKm,
  hrZoneRange,
  resolveMaxHr,
  asRecap,
  RECAP_SCHEMA_VERSION,
  RECAP_WEEKS,
  RECENT_WEIGHT,
  OLDER_WEIGHT,
  MIN_ACTIVITIES_PER_WEEK,
  MIN_QUALIFYING_WEEKS,
  KM_PER_TRAINING_DAY,
  MIN_FALLBACK_KM,
  MAX_FALLBACK_KM,
  OUTLIER_CAP_FACTOR,
  type RecapActivity,
} from './training-recap'

const TODAY = '2026-10-12' // Monday: window = 2026-08-31 .. 2026-10-11
const MONDAYS = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']
const PROFILE = { trainingDays: ['monday', 'wednesday', 'friday', 'saturday'], timezone: 'UTC' }

function run(date: string, km: number, pace: number | null, hr: number | null, maxHr: number | null = null): RecapActivity {
  return {
    sport_type: 'run',
    started_at: `${date}T07:00:00Z`,
    distance_m: km * 1000,
    duration_s: pace ? Math.round(km * pace) : null,
    avg_hr_bpm: hr,
    max_hr_bpm: maxHr,
    avg_pace_s_per_km: null,
    training_load: 50,
  }
}
function gym(date: string): RecapActivity {
  return { sport_type: 'gym', started_at: `${date}T18:00:00Z`, distance_m: null, duration_s: 3600 }
}
const day = (monday: string, n: number) => {
  const d = new Date(`${monday}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
/** Week of 3 runs (easy, easy, long) + 1 gym; easy 360 s/km @140 bpm, long 375 s/km. */
function normalWeek(monday: string, easyKm: number, longKm: number): RecapActivity[] {
  return [
    run(day(monday, 0), easyKm, 360, 140),
    run(day(monday, 2), easyKm, 360, 140),
    run(day(monday, 5), longKm, 375, 145, 190),
    gym(day(monday, 3)),
  ]
}
const NORMAL: RecapActivity[] = [
  ...normalWeek(MONDAYS[0], 8, 16),
  ...normalWeek(MONDAYS[1], 8, 16),
  ...normalWeek(MONDAYS[2], 9, 16),
  ...normalWeek(MONDAYS[3], 9, 16),
  ...normalWeek(MONDAYS[4], 10, 18),
  // last week: first run is a moderate-HR tempo
  run(day(MONDAYS[5], 0), 10, 330, 160),
  run(day(MONDAYS[5], 2), 10, 360, 140),
  run(day(MONDAYS[5], 5), 18, 375, 145, 190),
  gym(day(MONDAYS[5], 3)),
]

describe('computeTrainingRecap: normal 6 weeks', () => {
  const r = computeTrainingRecap(NORMAL, PROFILE, TODAY)
  it('is deterministic (same inputs, same output)', () => {
    expect(computeTrainingRecap(NORMAL, PROFILE, TODAY)).toEqual(r)
    expect(computeTrainingRecap([...NORMAL].reverse(), PROFILE, TODAY)).toEqual(r)
  })
  it('uses the 6 complete Monday weeks before today', () => {
    expect(r.schemaVersion).toBe(RECAP_SCHEMA_VERSION)
    expect(r.window).toEqual({ start: '2026-08-31', end: '2026-10-11' })
    expect(r.weeks.map((w) => w.weekStart)).toEqual(MONDAYS)
    expect(r.qualifyingWeeks).toBe(6)
    expect(r.excludedWeeks).toEqual([])
    expect(r.sparse).toBe(false)
  })
  it('summarises each week', () => {
    expect(r.weeks[0]).toMatchObject({ runCount: 3, runKm: 32, longestRunKm: 16, otherSessions: 1, otherHours: 1, avgHr: 142, totalLoad: 150 })
    // distance-weighted pace: (8*360*2 + 16*375) / 32 = 367.5 -> 368 (rounded)
    expect(r.weeks[0].avgPaceSPerKm).toBe(Math.round((8 * 360 * 2 + 16 * 375) / 32))
  })
  it('weights recent weeks more for the baseline', () => {
    // weeks km 32,32,34,34,38,38 with weights 1,1,2,2,2,2
    expect(r.baseline).toMatchObject({ weeklyKm: 35.2, source: 'history', uncappedKm: 35.2 })
  })
  it('derives typical values and labels', () => {
    expect(r.typical.runsPerWeek).toBe(3)
    expect(r.typical.easyPaceSPerKm).toBe(360)
    expect(r.typical.tempoPaceSPerKm).toBe(330)
    expect(r.typical.longRunKm).toBe(16)
    expect(r.typical.longRunPaceSPerKm).toBe(375)
    expect(r.maxHr).toEqual({ bpm: 190, source: 'data' })
  })
  it('splits intensity by HR share of max HR (long runs are labelled by distance but still counted by HR)', () => {
    // 18 runs: 140/190 = 0.74 easy (11), 145/190 = 0.76 moderate (6), 160/190 = 0.84 moderate (1)
    expect(r.intensity).toEqual({ easy: 0.61, moderate: 0.39, hard: 0, runsWithHr: 18 })
  })
  it('reports the trend, other sports and no layoff', () => {
    expect(r.trend).toEqual({ direction: 'stable', changePct: 13 })
    expect(r.otherSports).toEqual([{ sport: 'gym', sessions: 6, hours: 6 }])
    expect(r.layoff).toEqual({ zeroActivityWeeks: 0, longestGapWeeks: 0 })
    expect(r.dataQuality).toMatchObject({ runsCounted: 18, missingHrShare: 0, missingPaceShare: 0, noDistanceShare: 0 })
  })
})

describe('computeTrainingRecap: edge cases', () => {
  it('excludes a week with 1 activity and says why', () => {
    const acts = NORMAL.filter((a) => !(a.started_at >= '2026-09-14' && a.started_at < '2026-09-21')).concat(
      run('2026-09-16', 9, 360, 140)
    )
    const r = computeTrainingRecap(acts, PROFILE, TODAY)
    expect(r.qualifyingWeeks).toBe(5)
    expect(r.excludedWeeks).toEqual([{ weekStart: '2026-09-14', reason: `1 activity (minimum ${MIN_ACTIVITIES_PER_WEEK})` }])
    expect(r.weeks[2]).toMatchObject({ qualifies: false, runKm: 9 })
    // the excluded week is not in the baseline: (32+32)*1 + (34+38+38)*2 over 8 weight
    expect(r.baseline.weeklyKm).toBe(Math.round(((64 + 220) / 8) * 10) / 10)
  })

  it('keeps null (not guesses) when manual entries lack HR and pace', () => {
    const manual = MONDAYS.slice(2).flatMap((m) => [
      { sport_type: 'run', started_at: `${m}T07:00:00Z`, distance_m: 8000, duration_s: null },
      { sport_type: 'run', started_at: `${day(m, 3)}T07:00:00Z`, distance_m: 8000, duration_s: null },
    ])
    const r = computeTrainingRecap(manual, PROFILE, TODAY)
    expect(r.qualifyingWeeks).toBe(4)
    expect(r.typical.easyPaceSPerKm).toBeNull()
    expect(r.typical.longRunPaceSPerKm).toBeNull()
    expect(r.maxHr).toBeNull()
    expect(r.intensity).toBeNull()
    expect(r.weeks[2].avgPaceSPerKm).toBeNull()
    expect(r.weeks[2].avgHr).toBeNull()
    expect(r.weeks[2].totalLoad).toBeNull()
    expect(r.dataQuality).toMatchObject({ missingHrShare: 1, missingPaceShare: 1, noDistanceShare: 0 })
    expect(r.dataQuality.notes.join(' ')).toMatch(/no heart rate/)
    expect(r.dataQuality.notes.join(' ')).toMatch(/no usable pace/)
    expect(r.dataQuality.notes.join(' ')).toMatch(/Max heart rate unknown/)
  })

  it('falls back to 220 minus age for max HR, and counts runs with no distance', () => {
    const acts = [
      ...NORMAL.map((a) => ({ ...a, max_hr_bpm: null })),
      { sport_type: 'run', started_at: '2026-10-07T07:00:00Z', distance_m: null, duration_s: 1800 },
    ]
    const r = computeTrainingRecap(acts, { ...PROFILE, dateOfBirth: '1990-10-13' }, TODAY)
    expect(r.maxHr).toEqual({ bpm: 220 - 35, source: 'age' }) // birthday tomorrow: 35
    expect(r.dataQuality.noDistanceShare).toBe(0.05)
    expect(r.dataQuality.notes.join(' ')).toMatch(/220 minus age/)
    expect(r.dataQuality.notes.join(' ')).toMatch(/no distance/)
  })

  it('reports a layoff gap', () => {
    const acts = NORMAL.filter((a) => !(a.started_at >= '2026-09-14' && a.started_at < '2026-09-28'))
    const r = computeTrainingRecap(acts, PROFILE, TODAY)
    expect(r.qualifyingWeeks).toBe(4)
    expect(r.layoff).toEqual({ zeroActivityWeeks: 2, longestGapWeeks: 2 })
    expect(r.excludedWeeks.map((w) => w.reason)).toEqual(['no activity', 'no activity'])
  })

  it('caps an outlier week (a race) for the baseline', () => {
    const base = MONDAYS.slice(0, 5).flatMap((m) => [run(day(m, 0), 15, 360, 140), run(day(m, 3), 15, 360, 140)])
    const race = [run('2026-10-05', 5, 360, 140), run('2026-10-10', 95, 400, 150)]
    const r = computeTrainingRecap([...base, ...race], PROFILE, TODAY)
    // weeks 30,30,30,30,30,100; median 30 -> cap 30 x OUTLIER_CAP_FACTOR = 45
    expect(OUTLIER_CAP_FACTOR).toBe(1.5)
    expect(r.baseline.uncappedKm).toBe(44) // (30+30 + 2*(30+30+30+100)) / 10
    expect(r.baseline.weeklyKm).toBe(33) // (30+30 + 2*(30+30+30+45)) / 10
    expect(r.weeks[5].capped).toBe(true)
    expect(r.weeks.slice(0, 5).some((w) => w.capped)).toBe(false)
    expect(r.dataQuality.notes.join(' ')).toMatch(/capped/)
    // the long-run typical uses the median of weekly longest runs, so one race does not own it
    expect(r.typical.longRunKm).toBe(15)
  })

  it('does not cap with too few weeks to have a median', () => {
    const acts = [run('2026-10-05', 5, 360, 140), run('2026-10-10', 95, 400, 150)]
    const r = computeTrainingRecap(acts, PROFILE, TODAY)
    expect(r.qualifyingWeeks).toBe(1)
    expect(r.weeks[5].capped).toBe(false)
  })

  it('handles a brand-new athlete with no data', () => {
    const r = computeTrainingRecap([], PROFILE, TODAY)
    expect(r.qualifyingWeeks).toBe(0)
    expect(r.sparse).toBe(true)
    expect(r.baseline).toMatchObject({ weeklyKm: 12, source: 'fallback', fallbackKm: 12, uncappedKm: null })
    expect(r.typical).toEqual({ runsPerWeek: null, easyPaceSPerKm: null, tempoPaceSPerKm: null, longRunKm: null, longRunPaceSPerKm: null })
    expect(r.intensity).toBeNull()
    expect(r.trend).toBeNull()
    expect(r.maxHr).toBeNull()
    expect(r.layoff.zeroActivityWeeks).toBe(RECAP_WEEKS)
    expect(r.dataQuality).toMatchObject({ runsCounted: 0, missingHrShare: null })
    expect(r.dataQuality.notes).toContain('No qualifying weeks in the last 6 weeks')
  })

  it('sparse history uses the lower of history and the training-day fallback', () => {
    const big = ['2026-10-05', '2026-09-28'].flatMap((m) => [run(m, 20, 360, 140), run(day(m, 3), 20, 360, 140)])
    const r = computeTrainingRecap(big, PROFILE, TODAY)
    expect(r.qualifyingWeeks).toBe(2)
    expect(r.qualifyingWeeks).toBeLessThan(MIN_QUALIFYING_WEEKS)
    expect(r.baseline).toMatchObject({ weeklyKm: 12, source: 'fallback' }) // history 40 km, fallback 12
    const small = ['2026-10-05', '2026-09-28'].flatMap((m) => [run(m, 2.5, 360, 140), run(day(m, 3), 2.5, 360, 140)])
    expect(computeTrainingRecap(small, PROFILE, TODAY).baseline.weeklyKm).toBe(5)
  })

  it('ignores the current partial week and anything older than the window', () => {
    const r = computeTrainingRecap([run('2026-10-12', 10, 360, 140), run('2026-10-11', 10, 360, 140), run('2026-08-30', 10, 360, 140)], PROFILE, TODAY)
    expect(r.weeks.reduce((s, w) => s + w.activityCount, 0)).toBe(1) // only Sunday 10-11
  })

  it('assigns activities to local weeks using the athlete timezone', () => {
    // Sunday 23:30 UTC is already Monday 12:30 in Auckland (UTC+13 in October)
    const a = { sport_type: 'run', started_at: '2026-10-04T23:30:00Z', distance_m: 5000, duration_s: 1800 }
    expect(computeTrainingRecap([a], { timezone: 'UTC' }, TODAY).weeks[4].activityCount).toBe(1)
    expect(computeTrainingRecap([a], { timezone: 'Pacific/Auckland' }, TODAY).weeks[5].activityCount).toBe(1)
  })

  it('classifies pace-only runs relative to the athlete median when HR is missing', () => {
    const acts = MONDAYS.slice(0, 4).flatMap((m) => [
      run(day(m, 0), 8, 360, null),
      run(day(m, 2), 8, 360, null),
      run(day(m, 4), 8, 300, null), // 17% faster than median 360 -> hard
    ])
    const r = computeTrainingRecap(acts, PROFILE, TODAY)
    expect(r.typical.easyPaceSPerKm).toBe(360)
    expect(r.typical.tempoPaceSPerKm).toBe(300)
    expect(r.intensity).toBeNull()
  })
})

describe('constants and helpers', () => {
  it('exposes the proposed open-point values', () => {
    expect([RECAP_WEEKS, RECENT_WEIGHT, OLDER_WEIGHT, MIN_ACTIVITIES_PER_WEEK, MIN_QUALIFYING_WEEKS]).toEqual([6, 2, 1, 2, 3])
    expect([KM_PER_TRAINING_DAY, MIN_FALLBACK_KM, MAX_FALLBACK_KM]).toEqual([3, 6, 20])
  })
  it('scales the fallback by training days with a min and a max', () => {
    expect(fallbackWeeklyKm(['monday', 'wednesday', 'friday', 'saturday'])).toBe(12)
    expect(fallbackWeeklyKm(null)).toBe(12) // default 4 days
    expect(fallbackWeeklyKm(['monday'])).toBe(MIN_FALLBACK_KM)
    expect(fallbackWeeklyKm(['monday', 'tuesday', 'thursday', 'friday', 'saturday', 'sunday'])).toBe(18)
    expect(fallbackWeeklyKm(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])).toBe(MAX_FALLBACK_KM)
  })
  it('resolves max HR: data, then age, then unknown; ignores implausible samples', () => {
    expect(resolveMaxHr([185, 192, 400], '1990-01-01', TODAY)).toEqual({ bpm: 192, source: 'data' })
    expect(resolveMaxHr([60], '1990-01-01', TODAY)).toEqual({ bpm: 184, source: 'age' })
    expect(resolveMaxHr([], null, TODAY)).toBeNull()
    expect(resolveMaxHr([], 'garbage', TODAY)).toBeNull()
  })
  it('computes bpm ranges per HR zone', () => {
    expect(hrZoneRange(2, 190)).toEqual({ low: 114, high: 133 })
    expect(hrZoneRange(5, 190)).toEqual({ low: 171, high: 190 })
    expect(hrZoneRange(0, 190)).toBeNull()
    expect(hrZoneRange(6, 190)).toBeNull()
  })
  it('asRecap accepts the current schema only', () => {
    const r = computeTrainingRecap([], PROFILE, TODAY)
    expect(asRecap(JSON.parse(JSON.stringify(r)))).toEqual(r)
    expect(asRecap({ ...r, schemaVersion: 99 })).toBeNull()
    expect(asRecap(null)).toBeNull()
    expect(asRecap('x')).toBeNull()
  })
})
