import { describe, it, expect } from 'vitest'
import { repairMissingLongRuns, repairPlan, sanitizePlan, validatePlan, validatePlanDetailed, weeklyRunKm } from './plan-guardrails'
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
