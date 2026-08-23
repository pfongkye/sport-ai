import { z } from 'zod'

/**
 * Zod schemas for the free-form / voice activity-entry feature.
 *
 * Two roles:
 *  - `activityDraftSchema` is the shape the LLM parser must return (see
 *    `parseActivity`) AND the shape the create endpoint re-validates before
 *    inserting. One schema, one source of truth (spec Req 5.3).
 *  - `validateDraft` runs the same schema and returns a flat field→message map
 *    the confirm form can render inline (spec Req 3.4).
 *
 * Ranges are sanity bounds, not physiology limits — they exist to reject
 * obviously-wrong parses (e.g. HR 900), not to police edge athletes.
 */

const SPORT_TYPES = ['run', 'football', 'gym', 'cycle', 'other'] as const

export const strengthBlockSchema = z.object({
  exercise: z.string().min(1).max(60),
  sets: z.number().int().min(1).max(50).nullable(),
  reps: z.number().int().min(1).max(1000).nullable(),
  weightKg: z.number().min(0).max(1000).nullable(),
})

/**
 * Full draft schema. `sportType` and `startedAt` are the only required fields
 * for a valid save; everything else is optional/nullable and left null when the
 * utterance didn't state it (Req 1.8 — never fabricate).
 */
export const activityDraftSchema = z.object({
  sportType: z.enum(SPORT_TYPES),
  // ISO datetime; the parser emits local wall-clock time as ISO.
  startedAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  dateTimeNeedsConfirmation: z.boolean().default(false),
  durationS: z.number().int().min(1).max(86_400).nullable().default(null),
  distanceM: z.number().min(1).max(1_000_000).nullable().default(null),
  avgHrBpm: z.number().int().min(20).max(250).nullable().default(null),
  maxHrBpm: z.number().int().min(20).max(250).nullable().default(null),
  avgPaceSPerKm: z.number().int().min(60).max(3_600).nullable().default(null),
  avgCadenceRpm: z.number().min(0).max(300).nullable().default(null),
  caloriesKcal: z.number().min(0).max(30_000).nullable().default(null),
  rpe: z.number().min(1).max(10).nullable().default(null),
  notes: z.string().max(4_000).nullable().default(null),
  strength: z.array(strengthBlockSchema).max(50).default([]),
  assumptions: z.array(z.string().max(300)).max(20).default([]),
  confidence: z.enum(['high', 'low']).default('low'),
  transcript: z.string().max(4_000).default(''),
})

export type ActivityDraftInput = z.infer<typeof activityDraftSchema>

/**
 * Schema the LLM is asked to fill. Same shape as the draft but with everything
 * nullable/loose so a partial parse never hard-fails — the endpoint enforces the
 * strict `activityDraftSchema` at save time instead. `sportType`/`startedAt` may
 * be null here (e.g. vague "my last run") and get resolved in the confirm step.
 */
export const parsedDraftSchema = z.object({
  sportType: z.enum(SPORT_TYPES).nullable(),
  startedAt: z.string().nullable(),
  dateTimeNeedsConfirmation: z.boolean(),
  durationS: z.number().nullable(),
  distanceM: z.number().nullable(),
  avgHrBpm: z.number().nullable(),
  maxHrBpm: z.number().nullable(),
  avgPaceSPerKm: z.number().nullable(),
  avgCadenceRpm: z.number().nullable(),
  caloriesKcal: z.number().nullable(),
  rpe: z.number().nullable(),
  notes: z.string().nullable(),
  strength: z.array(strengthBlockSchema),
  assumptions: z.array(z.string()),
  confidence: z.enum(['high', 'low']),
})

export type ParsedDraft = z.infer<typeof parsedDraftSchema>

/**
 * Validate a confirmed draft for the UI. Returns `{ ok: true, data }` or
 * `{ ok: false, errors }` where errors maps field name → first message.
 */
export function validateDraft(
  input: unknown
): { ok: true; data: ActivityDraftInput } | { ok: false; errors: Record<string, string> } {
  const result = activityDraftSchema.safeParse(input)
  if (result.success) return { ok: true, data: result.data }

  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !(key in errors)) {
      errors[key] = issue.message
    }
  }
  return { ok: false, errors }
}
