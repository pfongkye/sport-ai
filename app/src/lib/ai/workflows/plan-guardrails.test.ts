import { describe, it, expect } from 'vitest'
import { sanitizePlan, validatePlan } from './plan-guardrails'
import { makeSkeleton, validPlanFor } from './plan-fixtures'

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
