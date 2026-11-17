import { describe, it, expect } from 'vitest'
import { repairLongRuns, repairMissingLongRuns, repairPlan, repairRaceDay, sanitizePlan, validatePlan, validatePlanDetailed, weeklyRunKm } from './plan-guardrails'
import { makeSkeleton, planWithWeeklyKm, validPlanFor } from './plan-fixtures'

describe('plan guardrails', () => {
  const sk = makeSkeleton({ goalDate: '2027-01-31' })

  it('accepts a plan that follows the skeleton', () => {
    expect(validatePlan(validPlanFor(sk), sk)).toEqual([])
  })

  it('rejects a session outside the plan window', () => {
    const plan = validPlanFor(sk)
    plan.sessions.push({ ...plan.sessions[0], scheduledDate: '2027-02-06' })
    expect(validatePlan(plan, sk).join(' ')).toMatch(/outside the plan window/)
  })

  it('rejects an invalid date and a non-training day', () => {
    const plan = validPlanFor(sk)
    plan.sessions[0] = { ...plan.sessions[0], scheduledDate: 'next friday' }
    expect(validatePlan(plan, sk).join(' ')).toMatch(/Invalid date/)
    const plan2 = validPlanFor(sk)
    plan2.sessions[0] = { ...plan2.sessions[0], scheduledDate: '2026-10-13' } // Tuesday
    expect(validatePlan(plan2, sk).join(' ')).toMatch(/not one of the athlete's training days/)
  })

  it('rejects an unsafe weekly volume jump', () => {
    const plan = validPlanFor(sk)
    // Double every run in week 3 (also blows past the week target).
    const w = sk.weeks[2]
    for (const s of plan.sessions) {
      if (s.scheduledDate >= w.weekStart && s.scheduledDate <= w.slotDates[w.slotDates.length - 1]) {
        s.targetDistanceM = (s.targetDistanceM ?? 0) * 2
      }
    }
    const issues = validatePlan(plan, sk).join(' ')
    expect(issues).toMatch(/jumps more than 10%/)
    expect(issues).toMatch(/above the .* km cap/)
  })

  it('requires a rest day in every full week', () => {
    const all = makeSkeleton({ goalDate: null })
    const sevenDay = {
      ...all,
      trainingDayIndexes: [0, 1, 2, 3, 4, 5, 6],
      weeks: all.weeks.map((w, i) =>
        i === 0
          ? { ...w, full: true, slotDates: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'] }
          : w
      ),
    }
    const w0 = sevenDay.weeks[0]
    const plan = {
      title: 't', goal: 'g', startDate: sevenDay.startDate, endDate: sevenDay.endDate,
      sessions: w0.slotDates.map((d) => ({
        scheduledDate: d, sportType: 'run' as const, sessionType: 'easy', description: '',
        targetDistanceM: 1000, targetDurationS: null, targetHrZone: null,
      })),
    }
    expect(validatePlan(plan, sevenDay).join(' ')).toMatch(/no rest day/)
  })

  it('requires a long run in full build weeks', () => {
    const plan = validPlanFor(sk)
    for (const s of plan.sessions) s.sessionType = 'easy'
    expect(validatePlan(plan, sk).join(' ')).toMatch(/no long run/)
  })

  it('rejects more than 2 sessions on a day', () => {
    const plan = validPlanFor(sk)
    plan.sessions.push({ ...plan.sessions[0] }, { ...plan.sessions[0] })
    expect(validatePlan(plan, sk).join(' ')).toMatch(/has 3 sessions/)
  })

  it('sanitizePlan drops explicit rest rows', () => {
    const plan = validPlanFor(sk)
    const n = plan.sessions.length
    plan.sessions.push({ ...plan.sessions[0], sessionType: 'Rest' })
    expect(sanitizePlan(plan).sessions).toHaveLength(n)
  })
})

describe('plan repair', () => {
  const sk = makeSkeleton({ goalDate: '2026-12-06', baseline: 30 })
  // Week index 2 jumps 20.1 -> 23.0 km (the real-world near miss).
  const nearMiss = [20.1, 20.1, 23.0, 22.0, 22.5, 23, 24, 15]

  it('classifies volume problems as soft and structural ones as hard', () => {
    const plan = planWithWeeklyKm(sk, nearMiss)
    expect(validatePlanDetailed(plan, sk).hard).toEqual([])
    expect(validatePlanDetailed(plan, sk).soft.join(' ')).toMatch(/jumps more than 10%/)
    plan.sessions.push({ ...plan.sessions[0], scheduledDate: '2027-03-01' })
    expect(validatePlanDetailed(plan, sk).hard.join(' ')).toMatch(/outside the plan window/)
  })

  it('repairs the 20.1 -> 23.0 km week to <= 22.1 km and records it', () => {
    const plan = planWithWeeklyKm(sk, nearMiss)
    expect(validatePlan(plan, sk).length).toBeGreaterThan(0)
    const r = repairPlan(plan, sk)
    expect(weeklyRunKm(r.plan, sk)[2]).toBeLessThanOrEqual(22.11)
    expect(validatePlan(r.plan, sk)).toEqual([])
    expect(r.adjustments).toHaveLength(1)
    expect(r.adjustments[0]).toMatch(/^Week of 2026-10-26 reduced from 23\.0 km to 22\.\d km to keep progression under 10%/)
    expect(r.sessionNotes.filter(Boolean).length).toBe(sk.weeks[2].slotDates.length)
  })

  it('cascades: later weeks are re-checked against the repaired previous week', () => {
    const plan = planWithWeeklyKm(sk, [20.1, 20.1, 23.0, 25.3, 25.0, 25.5, 26, 15])
    const before = validatePlan(plan, sk)
    expect(before.join(' ')).toMatch(/2026-10-26/)
    const r = repairPlan(plan, sk)
    const km = weeklyRunKm(r.plan, sk)
    expect(km[2]).toBeLessThanOrEqual(20.1 * 1.1 + 0.01)
    expect(km[3]).toBeLessThanOrEqual(km[2] * 1.1 + 0.01)
    expect(r.adjustments.length).toBeGreaterThanOrEqual(2)
    expect(validatePlan(r.plan, sk)).toEqual([])
  })

  it('never increases a distance or duration, and does not touch compliant weeks or the taper', () => {
    const plan = planWithWeeklyKm(sk, nearMiss)
    const r = repairPlan(plan, sk)
    r.plan.sessions.forEach((s, i) => {
      expect(s.targetDistanceM ?? 0).toBeLessThanOrEqual(plan.sessions[i].targetDistanceM ?? 0)
      expect(s.targetDurationS ?? 0).toBeLessThanOrEqual(plan.sessions[i].targetDurationS ?? 0)
    })
    const taper = sk.weeks[sk.weeks.length - 1]
    expect(taper.phase).toBe('taper')
    const taperIdx = plan.sessions.map((s, i) => (taper.slotDates.includes(s.scheduledDate) ? i : -1)).filter((i) => i >= 0)
    for (const i of taperIdx) expect(r.plan.sessions[i]).toEqual(plan.sessions[i])
  })

  it('keeps the long run the longest session after scaling', () => {
    const plan = planWithWeeklyKm(sk, nearMiss)
    const r = repairPlan(plan, sk)
    const w = sk.weeks[2]
    const inWeek = r.plan.sessions.filter((s) => w.slotDates.includes(s.scheduledDate))
    const long = inWeek.find((s) => /long/i.test(s.sessionType))!
    expect(Math.max(...inWeek.map((s) => s.targetDistanceM ?? 0))).toBe(long.targetDistanceM)
  })

  it('leaves a week that would need a cut deeper than 40% for regeneration', () => {
    const plan = planWithWeeklyKm(sk, [20.1, 20.1, 40, 22, 22.5, 23, 24, 15])
    const r = repairPlan(plan, sk)
    expect(r.adjustments).toEqual([])
    expect(validatePlanDetailed(r.plan, sk).soft.length).toBeGreaterThan(0)
  })
})

describe('repairMissingLongRuns', () => {
  const sk = makeSkeleton({ goalDate: '2027-01-31' })
  const week = sk.weeks[2]
  const stripLong = () => {
    const plan = validPlanFor(sk)
    for (const s of plan.sessions) if (week.slotDates.includes(s.scheduledDate)) s.sessionType = 'easy'
    return plan
  }

  it('relabels the longest run of a week that has none, leaving distances untouched', () => {
    const plan = stripLong()
    expect(validatePlanDetailed(plan, sk).hard.join(' ')).toMatch(/has no long run/)
    const r = repairMissingLongRuns(plan, sk)
    expect(validatePlanDetailed(r.plan, sk).hard).toEqual([])
    const inWeek = r.plan.sessions.filter((s) => week.slotDates.includes(s.scheduledDate))
    const long = inWeek.filter((s) => s.sessionType === 'long run')
    expect(long).toHaveLength(1)
    expect(long[0].targetDistanceM).toBe(Math.max(...inWeek.map((s) => s.targetDistanceM ?? 0)))
    expect(weeklyRunKm(r.plan, sk)).toEqual(weeklyRunKm(plan, sk))
    expect(r.adjustments).toHaveLength(1)
    expect(r.sessionNotes.filter(Boolean)).toHaveLength(1)
  })

  it('does not touch a week with no run to relabel', () => {
    const plan = stripLong()
    for (const s of plan.sessions) if (week.slotDates.includes(s.scheduledDate)) s.sportType = 'gym'
    const r = repairMissingLongRuns(plan, sk)
    expect(r.adjustments).toEqual([])
    expect(validatePlanDetailed(r.plan, sk).hard.join(' ')).toMatch(/has no long run/)
  })

  it('is a no-op for a valid plan', () => {
    const plan = validPlanFor(sk)
    const r = repairMissingLongRuns(plan, sk)
    expect(r.plan.sessions).toEqual(plan.sessions)
    expect(r.adjustments).toEqual([])
  })
})

describe('race day guardrails', () => {
  // Race on Sunday 2027-03-21; profile days are mon/wed/fri/sat so Sunday is NOT a training day.
  const race = { distance: '10k' as const, distanceKm: 10, targetTimeS: 2400 }
  const sk = makeSkeleton({ today: '2026-10-12', goalDate: '2027-03-21', race, baseline: 40 })
  const RACE = '2027-03-21'
  const lastWeek = sk.weeks[sk.weeks.length - 1]
  const raceSessions = (p: ReturnType<typeof validPlanFor>) => p.sessions.filter((s) => s.scheduledDate === RACE)

  it('accepts a plan that follows the race skeleton', () => {
    const plan = validPlanFor(sk)
    expect(validatePlanDetailed(plan, sk)).toEqual({ hard: [], soft: [] })
    expect(raceSessions(plan)).toHaveLength(1)
  })

  it('inserts the race session when the model left the date empty', () => {
    const plan = validPlanFor(sk)
    plan.sessions = plan.sessions.filter((s) => s.scheduledDate !== RACE)
    expect(validatePlanDetailed(plan, sk).hard.join(' ')).toMatch(/exactly one session, the race/)
    const fixed = repairRaceDay(plan, sk)
    const r = raceSessions(fixed.plan)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({
      sportType: 'run',
      sessionType: 'race',
      targetDistanceM: 10000,
      targetDurationS: 2400,
      targetHrZone: null,
      description: 'Race day: 10 km. Target 40:00 (4:00/km).',
    })
    expect(fixed.sessionNotes).toHaveLength(fixed.plan.sessions.length)
    expect(fixed.adjustments.join(' ')).toMatch(/race \(10 km\) was added/)
    expect(validatePlanDetailed(fixed.plan, sk).hard).toEqual([])
  })

  it('describes a race without a target time as run by feel', () => {
    const noTime = makeSkeleton({
      today: '2026-10-12',
      goalDate: '2027-03-21',
      race: { ...race, targetTimeS: null },
    })
    const plan = validPlanFor(noTime)
    plan.sessions = plan.sessions.filter((s) => s.scheduledDate !== RACE)
    const r = raceSessions(repairRaceDay(plan, noTime).plan)[0]
    expect(r.description).toBe('Race day: 10 km. Run it by feel, start controlled.')
    expect(r.targetDurationS).toBeNull()
  })

  it('corrects a wrong race distance and duration, and relabels a run on the date', () => {
    const plan = validPlanFor(sk)
    const r = raceSessions(plan)[0]
    r.targetDistanceM = 15000
    r.targetDurationS = 100
    expect(validatePlanDetailed(plan, sk).hard.join(' ')).toMatch(/race session distance must be 10 km/)
    const fixed = repairRaceDay(plan, sk)
    expect(raceSessions(fixed.plan)[0]).toMatchObject({ targetDistanceM: 10000, targetDurationS: 2400 })

    const easy = validPlanFor(sk)
    easy.sessions = easy.sessions.map((s) => (s.scheduledDate === RACE ? { ...s, sessionType: 'easy', targetDistanceM: 5000 } : s))
    const relabelled = repairRaceDay(easy, sk)
    expect(raceSessions(relabelled.plan)).toHaveLength(1)
    expect(raceSessions(relabelled.plan)[0].sessionType).toBe('race')
    expect(relabelled.adjustments.join(' ')).toMatch(/relabelled as the race/)
  })

  it('removes the day before the race and extra sessions on race day', () => {
    const plan = validPlanFor(sk)
    plan.sessions.push({ ...plan.sessions[0], scheduledDate: '2027-03-20', sessionType: 'easy' })
    plan.sessions.push({ ...plan.sessions[0], scheduledDate: RACE, sportType: 'gym', sessionType: 'strength' })
    const issues = validatePlanDetailed(plan, sk).hard.join(' ')
    expect(issues).toMatch(/day before the race/)
    expect(issues).toMatch(/exactly one session/)
    const fixed = repairRaceDay(plan, sk)
    expect(fixed.plan.sessions.some((s) => s.scheduledDate === '2027-03-20')).toBe(false)
    expect(raceSessions(fixed.plan)).toHaveLength(1)
    expect(validatePlanDetailed(fixed.plan, sk).hard).toEqual([])
  })

  it('is a no-op without a race', () => {
    const g = makeSkeleton({ goalDate: '2027-01-31' })
    const plan = validPlanFor(g)
    expect(repairRaceDay(plan, g).plan).toBe(plan)
  })

  it('scales a 40 km long run down to the 10 km cap, and rejects it when left unrepaired', () => {
    const plan = validPlanFor(sk)
    const i = plan.sessions.findIndex((s) => /long/i.test(s.sessionType) && s.scheduledDate >= sk.weeks[2].weekStart)
    plan.sessions[i] = { ...plan.sessions[i], targetDistanceM: 40000, targetDurationS: 14400 }
    expect(validatePlanDetailed(plan, sk).hard.join(' ')).toMatch(/longest-run limit/)
    const fixed = repairLongRuns(plan, sk)
    const w = sk.weeks.find((x) => plan.sessions[i].scheduledDate >= x.weekStart && plan.sessions[i].scheduledDate <= x.slotDates[x.slotDates.length - 1])!
    expect(fixed.plan.sessions[i].targetDistanceM).toBeLessThanOrEqual(w.maxLongRunKm * 1000)
    expect(fixed.plan.sessions[i].targetDurationS).toBeLessThan(14400)
    expect(fixed.sessionNotes[i]).toMatch(/reduced automatically/)
    expect(fixed.adjustments).toHaveLength(1)
    expect(validatePlanDetailed(fixed.plan, sk).hard).toEqual([])
  })

  it('flags a race week run above the race week cap and repairs it without touching the race', () => {
    const plan = validPlanFor(sk)
    plan.sessions.push({
      ...plan.sessions[0],
      scheduledDate: lastWeek.slotDates[0],
      sessionType: 'easy',
      targetDistanceM: 12000,
      targetDurationS: 4000,
    })
    expect(validatePlanDetailed(plan, sk).hard.join(' ')).toMatch(/race week is above the 6 km limit/)
    const fixed = repairLongRuns(plan, sk)
    const run = fixed.plan.sessions.filter((s) => s.scheduledDate === lastWeek.slotDates[0])
    expect(run.every((s) => (s.targetDistanceM ?? 0) <= 6000)).toBe(true)
    expect(raceSessions(fixed.plan)[0].targetDistanceM).toBe(10000)
  })

  it('repairPlan never scales the race distance', () => {
    const plan = validPlanFor(sk)
    for (const s of plan.sessions) {
      if (s.scheduledDate >= lastWeek.weekStart && s.sessionType !== 'race') s.targetDistanceM = 6000
    }
    const out = repairPlan(plan, sk)
    expect(raceSessions(out.plan)[0].targetDistanceM).toBe(10000)
    expect(validatePlanDetailed(out.plan, sk).hard).toEqual([])
  })

  it('does not apply the ramp check to race and taper weeks', () => {
    const issues = validatePlanDetailed(validPlanFor(sk), sk).soft.join(' ')
    expect(issues).not.toMatch(/jumps more than/)
  })

  it('rejects a full taper week far below its target', () => {
    const plan = validPlanFor(sk)
    const taper = sk.weeks.find((w) => w.phase === 'taper')!
    for (const s of plan.sessions) {
      if (taper.slotDates.includes(s.scheduledDate)) s.targetDistanceM = 1000
    }
    expect(validatePlanDetailed(plan, sk).hard.join(' ')).toMatch(/Taper week .* below 40%/)
  })

  it('still checks a partial final week (race on a Tuesday after the plan starts mid-week)', () => {
    const tue = makeSkeleton({ today: '2026-10-12', goalDate: '2027-03-23', race })
    const last = tue.weeks[tue.weeks.length - 1]
    expect(last.phase).toBe('race')
    expect(last.full).toBe(false)
    const plan = validPlanFor(tue)
    expect(validatePlanDetailed(plan, tue).hard).toEqual([])
    plan.sessions.push({ ...plan.sessions[0], scheduledDate: '2027-03-22', sessionType: 'easy', targetDistanceM: 20000 })
    const hard = validatePlanDetailed(plan, tue).hard.join(' ')
    expect(hard).toMatch(/day before the race/)
    expect(hard).toMatch(/race week is above/)
  })
})
