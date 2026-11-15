import { describe, it, expect } from 'vitest'
import { applyRecapTargets, paceForSession } from './plan-recap-targets'
import { computeTrainingRecap, type TrainingRecap } from './training-recap'
import type { PlanDraft } from './plan-schema'

function recapWith(over: Partial<TrainingRecap['typical']>, maxHr: TrainingRecap['maxHr']): TrainingRecap {
  const base = computeTrainingRecap([], {}, '2026-10-12')
  return { ...base, typical: { ...base.typical, ...over }, maxHr }
}
const s = (over: Partial<PlanDraft['sessions'][number]>): PlanDraft['sessions'][number] => ({
  scheduledDate: '2026-10-13',
  sportType: 'run',
  sessionType: 'easy',
  description: 'Steady.',
  targetDistanceM: 10000,
  targetDurationS: 1234,
  targetHrZone: 2,
  ...over,
})
const plan = (sessions: PlanDraft['sessions']): PlanDraft => ({ title: 't', goal: 'g', startDate: '2026-10-12', endDate: '2026-12-06', sessions })

describe('applyRecapTargets', () => {
  const recap = recapWith({ easyPaceSPerKm: 360, tempoPaceSPerKm: 300, longRunPaceSPerKm: 375 }, { bpm: 190, source: 'data' })

  it('sets duration = distance x easy / long / tempo pace by session type', () => {
    const out = applyRecapTargets(
      plan([
        s({ sessionType: 'easy' }),
        s({ sessionType: 'Long run', targetDistanceM: 20000 }),
        s({ sessionType: 'tempo', targetDistanceM: 8000 }),
        s({ sessionType: 'recovery', targetDistanceM: 5000 }),
      ]),
      recap
    ).sessions
    expect(out.map((x) => x.targetDurationS)).toEqual([3600, 7500, 2400, 1800])
  })
  it('keeps the model value when pace is unknown or the type is not pace-led', () => {
    const noPace = recapWith({}, null)
    expect(applyRecapTargets(plan([s({})]), noPace).sessions[0].targetDurationS).toBe(1234)
    expect(applyRecapTargets(plan([s({ sessionType: 'intervals' })]), recap).sessions[0].targetDurationS).toBe(1234)
    expect(paceForSession('intervals', recap)).toBeNull()
  })
  it('falls back to the easy pace for a long run with no long-run pace', () => {
    const r = recapWith({ easyPaceSPerKm: 360, longRunPaceSPerKm: null }, null)
    expect(paceForSession('long run', r)).toBe(360)
  })
  it('leaves non-run sessions and sessions without distance alone', () => {
    const out = applyRecapTargets(
      plan([s({ sportType: 'gym', sessionType: 'easy', targetDistanceM: null, targetDurationS: 2700, targetHrZone: null }), s({ targetDistanceM: null })]),
      recap
    ).sessions
    expect(out.map((x) => x.targetDurationS)).toEqual([2700, 1234])
  })
  it('appends the bpm range for the HR zone when max HR is known, once', () => {
    const once = applyRecapTargets(plan([s({ targetHrZone: 2 })]), recap)
    expect(once.sessions[0].description).toBe('Steady. Target HR 114-133 bpm (zone 2, from max HR 190).')
    expect(applyRecapTargets(once, recap).sessions[0].description).toBe(once.sessions[0].description)
  })
  it('adds no bpm text without max HR or without a zone', () => {
    expect(applyRecapTargets(plan([s({})]), recapWith({}, null)).sessions[0].description).toBe('Steady.')
    expect(applyRecapTargets(plan([s({ targetHrZone: null })]), recap).sessions[0].description).toBe('Steady.')
  })
})
