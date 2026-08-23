import { generateObject } from 'ai'
import { resolveUserAISettings, resolveModel } from './provider'
import { parsedDraftSchema, type ParsedDraft } from '@/lib/activities/draft-schema'
import type { ActivityDraft } from '@/types/activity'

/** Bounded parse time so a slow model doesn't hang the request (spec Req 6.2). */
const PARSE_TIMEOUT_MS = 20_000

export interface ParseActivityOptions {
  userId: string
  /** The athlete's current local time as an ISO string (from the client). Used
   *  to resolve relative dates like "yesterday"/"this morning". */
  clientNow?: string
  /** IANA timezone (e.g. "Europe/Paris") for context in the prompt. */
  tz?: string
  /** 'metric' | 'imperial' — affects how imperial phrasing is interpreted. */
  units?: string
}

/**
 * Turn a spoken/typed sentence into a structured `ActivityDraft`.
 *
 * Runs entirely server-side. Uses the AI SDK's `generateObject` with a zod
 * schema so the model is forced to return valid structured data — never free
 * text we'd have to re-parse. The provider/model/key come from the user's
 * settings (falling back to system keys), same as the coach agent.
 *
 * Rules encoded in the prompt (spec Req 1):
 *  - Only the supported sports; map synonyms (jog→run, weights→gym, etc.).
 *  - Normalise pace ("5'14/km" → 314 s/km), distance (→ metres).
 *  - Resolve relative dates against the athlete's local now.
 *  - NEVER invent metrics that weren't stated — leave them null.
 *  - When date/time is absent or vague ("my last run"), set
 *    dateTimeNeedsConfirmation = true and note it in `assumptions`.
 *
 * On any failure (no key, timeout, model error) returns a low-confidence draft
 * carrying just the transcript, so the UI can still show the manual form
 * pre-filled with what little we have.
 */
export async function parseActivity(
  text: string,
  opts: ParseActivityOptions
): Promise<ActivityDraft> {
  const transcript = text.trim()
  const nowIso = opts.clientNow ?? new Date().toISOString()

  const fallback = (assumption: string): ActivityDraft => ({
    sportType: null,
    startedAt: null,
    dateTimeNeedsConfirmation: true,
    durationS: null,
    distanceM: null,
    avgHrBpm: null,
    maxHrBpm: null,
    avgPaceSPerKm: null,
    avgCadenceRpm: null,
    caloriesKcal: null,
    rpe: null,
    notes: null,
    strength: [],
    assumptions: [assumption],
    confidence: 'low',
    transcript,
  })

  if (!transcript) return fallback('Nothing to parse — please describe the activity.')

  const { settings, userApiKey } = await resolveUserAISettings(opts.userId)
  const provider = settings?.ai_provider ?? 'openai'
  const modelId = settings?.ai_model ?? 'gpt-4o'
  const units = opts.units ?? settings?.units ?? 'metric'
  const tz = opts.tz ?? settings?.timezone ?? 'UTC'

  let model
  try {
    model = resolveModel(provider, modelId, userApiKey)
  } catch {
    return fallback('AI is not configured — fill in the fields manually.')
  }

  const system = [
    'You convert a short sentence describing ONE completed workout into structured data.',
    'Supported sport types: run, football, gym, cycle, other.',
    'Map synonyms: jog/running→run; weights/lifting/strength→gym; soccer→football; ride/bike/cycling→cycle; anything else→other.',
    `The athlete's current local time is ${nowIso} (timezone ${tz}). Their unit preference is ${units}.`,
    'Resolve relative dates ("yesterday", "this morning", "last night") against that local time and output startedAt as an ISO 8601 string in local time.',
    'If NO date and/or time is stated — including vague references like "my last run" — set startedAt to your best guess (or null) AND set dateTimeNeedsConfirmation=true, and add a short note to assumptions like "date/time not stated — please confirm".',
    'If an explicit date and time are both given, set dateTimeNeedsConfirmation=false.',
    'Normalise units: distanceM in metres; durationS in seconds; avgPaceSPerKm in seconds per kilometre (e.g. "5\'14/km" or "5:14 min/km" → 314; convert min/mile to s/km).',
    'Parse strength work into the strength array: one entry per exercise with sets, reps, weightKg (kg; convert lb→kg). Example "2x8 squat" → {exercise:"squat", sets:2, reps:8, weightKg:null}.',
    'CRITICAL: never invent or estimate a metric that was not stated. Leave anything unstated as null (or [] for strength). Do not guess HR, pace, calories, RPE, etc.',
    'Put any leftover descriptive detail (how it felt, conditions) into notes; otherwise notes=null.',
    'Set confidence="high" only when the sport and the main metrics are clearly stated; otherwise "low".',
  ].join('\n')

  let parsed: ParsedDraft
  try {
    const result = await generateObject({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: model as any,
      schema: parsedDraftSchema,
      system,
      prompt: transcript,
      abortSignal: AbortSignal.timeout(PARSE_TIMEOUT_MS),
    })
    parsed = result.object
  } catch (err) {
    console.error('[parse-activity] generateObject failed', err)
    return fallback('Could not parse automatically — please fill in the fields.')
  }

  return {
    sportType: parsed.sportType,
    startedAt: parsed.startedAt,
    dateTimeNeedsConfirmation: parsed.dateTimeNeedsConfirmation,
    durationS: parsed.durationS,
    distanceM: parsed.distanceM,
    avgHrBpm: parsed.avgHrBpm,
    maxHrBpm: parsed.maxHrBpm,
    avgPaceSPerKm: parsed.avgPaceSPerKm,
    avgCadenceRpm: parsed.avgCadenceRpm,
    caloriesKcal: parsed.caloriesKcal,
    rpe: parsed.rpe,
    notes: parsed.notes,
    strength: parsed.strength,
    assumptions: parsed.assumptions,
    confidence: parsed.confidence,
    transcript,
  }
}
