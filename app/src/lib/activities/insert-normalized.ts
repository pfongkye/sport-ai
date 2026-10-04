/**
 * Shared write path for a parsed/imported NormalizedActivity.
 *
 * Used by both the file-upload route (fit/gpx/tcx) and the Strava importer so
 * dedup, insert, and stream-writing behave identically. Dedup is by
 * (user_id, external_id) — backed by the activities UNIQUE constraint — so the
 * same workout imported twice (same file, or same Strava id) is skipped.
 *
 * The optional `rawFile` lets the file-upload path persist the original file to
 * Storage; Strava imports have no file and omit it.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { NormalizedActivity } from '@/types/activity'

export type InsertStatus = 'created' | 'duplicate' | 'error'

export interface InsertResult {
  status: InsertStatus
  activityId?: string
  message?: string
}

export interface RawFile {
  buffer: Buffer
  filename: string
  contentType?: string
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/**
 * Insert one NormalizedActivity for `userId`, skipping if an activity with the
 * same external_id already exists. Returns a status so callers can aggregate
 * per-item results. Never throws for the "duplicate" case — that's a normal skip.
 */
export async function insertNormalizedActivity(
  supabase: SupabaseClient<Database>,
  userId: string,
  activity: NormalizedActivity,
  rawFile?: RawFile
): Promise<InsertResult> {
  if (!activity.externalId) {
    return { status: 'error', message: 'Missing external_id (cannot dedup)' }
  }

  // Dedup: skip if this user already has an activity with this external_id.
  const { data: existing } = await supabase
    .from('activities')
    .select('id')
    .eq('user_id', userId)
    .eq('external_id', activity.externalId)
    .maybeSingle()

  if (existing) {
    return { status: 'duplicate', activityId: existing.id, message: 'Already imported' }
  }

  // Optionally store the raw file (non-fatal if it fails).
  let fileUrl: string | null = null
  if (rawFile) {
    const storagePath = `${userId}/activities/${Date.now()}-${sanitize(rawFile.filename)}`
    const { error: uploadErr } = await supabase.storage
      .from('activities')
      .upload(storagePath, rawFile.buffer, {
        contentType: rawFile.contentType ?? 'application/octet-stream',
        upsert: false,
      })
    fileUrl = uploadErr ? null : storagePath
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('activities')
    .insert({
      user_id: userId,
      source: activity.source,
      external_id: activity.externalId,
      sport_type: activity.sportType,
      started_at: activity.startedAt.toISOString(),
      duration_s: activity.durationS ?? null,
      distance_m: activity.distanceM ?? null,
      elevation_gain_m: activity.elevationGainM ?? null,
      avg_hr_bpm: activity.avgHrBpm ?? null,
      max_hr_bpm: activity.maxHrBpm ?? null,
      avg_pace_s_per_km: activity.avgPaceSPerKm ?? null,
      avg_cadence_rpm: activity.avgCadenceRpm ?? null,
      calories_kcal: activity.caloriesKcal ?? null,
      training_load: activity.trainingLoad ?? null,
      notes: activity.notes ?? null,
      file_url: fileUrl,
      raw_data: activity.rawData,
    })
    .select('id')
    .single()

  if (insertErr || !inserted) {
    // Unique-violation (race): treat as duplicate rather than a hard error.
    if (insertErr?.code === '23505') {
      return { status: 'duplicate', message: 'Already imported' }
    }
    return { status: 'error', message: insertErr?.message ?? 'Insert failed' }
  }

  // Insert streams (one row per stream type). Best-effort.
  if (activity.streams.length) {
    const streamRows = activity.streams.map((s) => ({
      activity_id: inserted.id,
      user_id: userId,
      stream_type: s.type,
      data: s.data,
    }))
    await supabase.from('activity_streams').insert(streamRows)
  }

  return { status: 'created', activityId: inserted.id }
}
