import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { StrengthBlock } from '@/types/activity'
import type { ActivityDraftInput } from './draft-schema'

/** Dedup window: manual entries have no external_id, so we treat an activity of
 *  the same sport starting within this window as a likely duplicate (spec Req 4.5). */
const DEDUP_WINDOW_MS = 90 * 60 * 1000 // ±90 min

export interface DuplicateCandidate {
  id: string
  started_at: string
}

/**
 * Find an existing activity that is likely the same as the one being logged:
 * same user, same sport_type, and started_at within ±90 min of the target.
 * Returns the closest candidate, or null. Used before a manual insert so the UI
 * can warn and require an explicit "save anyway".
 */
export async function findLikelyDuplicate(
  supabase: SupabaseClient<Database>,
  userId: string,
  args: { sportType: string; startedAt: string }
): Promise<DuplicateCandidate | null> {
  const target = new Date(args.startedAt).getTime()
  if (Number.isNaN(target)) return null

  const from = new Date(target - DEDUP_WINDOW_MS).toISOString()
  const to = new Date(target + DEDUP_WINDOW_MS).toISOString()

  const { data, error } = await supabase
    .from('activities')
    .select('id, started_at')
    .eq('user_id', userId)
    .eq('sport_type', args.sportType)
    .gte('started_at', from)
    .lte('started_at', to)

  if (error || !data?.length) return null

  // Return the candidate closest in time to the target.
  let best: DuplicateCandidate | null = null
  let bestDelta = Infinity
  for (const row of data) {
    const delta = Math.abs(new Date(row.started_at).getTime() - target)
    if (delta < bestDelta) {
      bestDelta = delta
      best = { id: row.id, started_at: row.started_at }
    }
  }
  return best
}

/**
 * Render a human-readable one-line summary of strength blocks for the `notes`
 * field, e.g. "squat 2x8, deadlift 3x5 @80kg". Feeds the existing embedding/RAG
 * pipeline (which indexes `notes`) while the structured data lives in raw_data.
 */
export function formatStrengthSummary(blocks: StrengthBlock[]): string {
  return blocks
    .map((b) => {
      const setsReps = b.sets != null && b.reps != null ? `${b.sets}x${b.reps}` : (b.reps != null ? `${b.reps} reps` : '')
      const weight = b.weightKg != null ? ` @${b.weightKg}kg` : ''
      return [b.exercise, setsReps].filter(Boolean).join(' ') + weight
    })
    .filter(Boolean)
    .join(', ')
}

/**
 * Compose the final `notes` value: the athlete's free notes plus a strength
 * summary when there are strength blocks. Either part may be empty.
 */
export function composeNotes(notes: string | null, strength: StrengthBlock[]): string | null {
  const parts: string[] = []
  if (notes && notes.trim()) parts.push(notes.trim())
  if (strength.length) {
    const summary = formatStrengthSummary(strength)
    if (summary) parts.push(summary)
  }
  return parts.length ? parts.join(' — ') : null
}

/**
 * Insert a confirmed draft as a `manual` activity (no streams, no file).
 * Structured strength + the original transcript are preserved in `raw_data`.
 * Scoped to `userId` (RLS also applies). Returns the new activity id.
 *
 * Shared by `POST /api/activities` and the `addActivity` chat tool so there is a
 * single write path (spec Req 5.3).
 */
export async function insertManualActivity(
  supabase: SupabaseClient<Database>,
  userId: string,
  draft: ActivityDraftInput
): Promise<{ id: string }> {
  const notes = composeNotes(draft.notes, draft.strength)

  const { data, error } = await supabase
    .from('activities')
    .insert({
      user_id: userId,
      source: 'manual',
      external_id: null,
      sport_type: draft.sportType,
      started_at: new Date(draft.startedAt).toISOString(),
      duration_s: draft.durationS,
      distance_m: draft.distanceM,
      avg_hr_bpm: draft.avgHrBpm,
      max_hr_bpm: draft.maxHrBpm,
      avg_pace_s_per_km: draft.avgPaceSPerKm,
      avg_cadence_rpm: draft.avgCadenceRpm,
      calories_kcal: draft.caloriesKcal,
      rpe: draft.rpe,
      notes,
      file_url: null,
      raw_data: {
        entry: 'freeform',
        transcript: draft.transcript || null,
        strength: draft.strength,
      },
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to insert activity')
  }
  return { id: data.id }
}
