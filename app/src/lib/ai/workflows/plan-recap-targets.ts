/**
 * Deterministic post-processing of the model's plan using the training recap
 * (spec Req 6.6). Runs AFTER guardrails/repair so durations follow the final
 * distances. Only fills what the data supports; otherwise the model's value stays.
 */
import { hrZoneRange, type TrainingRecap } from './training-recap'
import type { PlanDraft, PlannedSessionDraft } from './plan-schema'

const EASY_TYPES = ['easy', 'recovery', 'base', 'aerobic']
const TEMPO_TYPES = ['tempo', 'threshold']

/** The athlete's pace (s/km) for a session type, or null when unknown / not a pace-led type. */
export function paceForSession(sessionType: string, recap: TrainingRecap): number | null {
  const t = sessionType.trim().toLowerCase()
  const { easyPaceSPerKm: easy, tempoPaceSPerKm: tempo, longRunPaceSPerKm: long } = recap.typical
  if (t.includes('long')) return long ?? easy
  if (EASY_TYPES.some((k) => t.includes(k))) return easy
  if (TEMPO_TYPES.some((k) => t.includes(k))) return tempo
  return null
}

function withZoneRange(s: PlannedSessionDraft, recap: TrainingRecap): string {
  const zone = s.targetHrZone
  if (!recap.maxHr || zone == null) return s.description
  const r = hrZoneRange(zone, recap.maxHr.bpm)
  if (!r) return s.description
  const note = `Target HR ${r.low}-${r.high} bpm (zone ${zone}, from max HR ${recap.maxHr.bpm}).`
  return s.description.includes(note) ? s.description : `${s.description.trim()} ${note}`.trim()
}

export function applyRecapTargets(plan: PlanDraft, recap: TrainingRecap): PlanDraft {
  return {
    ...plan,
    sessions: plan.sessions.map((s) => {
      let durationS = s.targetDurationS
      if (s.sportType === 'run' && s.targetDistanceM && s.targetDistanceM > 0) {
        const pace = paceForSession(s.sessionType, recap)
        if (pace) durationS = Math.round((s.targetDistanceM / 1000) * pace)
      }
      return { ...s, targetDurationS: durationS, description: withZoneRange(s, recap) }
    }),
  }
}
