import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseActivityFile, getExtension, isSupportedFormat } from '@/lib/importers'
import { MAX_FILE_SIZE_BYTES } from '@/types/activity'

export const runtime = 'nodejs' // fit-file-parser needs Node APIs, not edge

/**
 * POST /api/activities/upload
 * Multipart form with one or more files (field name: "files").
 * Parses each, stores the raw file, and inserts activity + streams.
 * Returns a per-file result array so the UI can show partial success.
 */
export async function POST(request: Request) {
  try {
    return await handleUpload(request)
  } catch (err) {
    // Anything that escapes the per-file loop lands here as readable JSON,
    // never a bare 500 HTML page.
    console.error('[activities/upload] fatal error', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload handler crashed' },
      { status: 500 }
    )
  }
}

async function handleUpload(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (e) {
    console.error('[activities/upload] formData parse failed', e)
    return NextResponse.json(
      { error: 'Could not read the upload (file too large or malformed multipart)' },
      { status: 400 }
    )
  }

  const files = formData.getAll('files').filter((f): f is File => f instanceof File)
  if (!files.length) {
    return NextResponse.json({ error: 'No files provided' }, { status: 400 })
  }

  const results: Array<{
    filename: string
    status: 'created' | 'duplicate' | 'error'
    activityId?: string
    message?: string
  }> = []

  for (const file of files) {
    try {
      if (!isSupportedFormat(file.name)) {
        results.push({
          filename: file.name,
          status: 'error',
          message: 'Unsupported format (use .fit, .gpx, .tcx)',
        })
        continue
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        results.push({ filename: file.name, status: 'error', message: 'File too large (max 50MB)' })
        continue
      }

      const buffer = Buffer.from(await file.arrayBuffer())
      const activity = await parseActivityFile(file.name, buffer)

      // Dedup: skip if this user already has an activity with this externalId
      const { data: existing } = await supabase
        .from('activities')
        .select('id')
        .eq('user_id', user.id)
        .eq('external_id', activity.externalId!)
        .maybeSingle()

      if (existing) {
        results.push({
          filename: file.name,
          status: 'duplicate',
          activityId: existing.id,
          message: 'Already uploaded',
        })
        continue
      }

      // Store raw file in Storage: {user_id}/activities/{timestamp}-{name}
      const storagePath = `${user.id}/activities/${Date.now()}-${sanitize(file.name)}`
      const { error: uploadErr } = await supabase.storage
        .from('activities')
        .upload(storagePath, buffer, {
          contentType: 'application/octet-stream',
          upsert: false,
        })
      // Non-fatal: keep the parsed activity even if raw storage fails
      const fileUrl = uploadErr ? null : storagePath

      // Insert activity
      const { data: inserted, error: insertErr } = await supabase
        .from('activities')
        .insert({
          user_id: user.id,
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
        results.push({
          filename: file.name,
          status: 'error',
          message: insertErr?.message ?? 'Insert failed',
        })
        continue
      }

      // Insert streams (one row per stream type)
      if (activity.streams.length) {
        const streamRows = activity.streams.map((s) => ({
          activity_id: inserted.id,
          user_id: user.id,
          stream_type: s.type,
          data: s.data,
        }))
        await supabase.from('activity_streams').insert(streamRows)
      }

      results.push({ filename: file.name, status: 'created', activityId: inserted.id })
    } catch (err) {
      console.error('[activities/upload] failed for', file.name, err)
      results.push({
        filename: file.name,
        status: 'error',
        message: err instanceof Error ? err.message : 'Parse failed',
      })
    }
  }

  const created = results.filter((r) => r.status === 'created').length
  return NextResponse.json({ results, created }, { status: created > 0 ? 201 : 200 })
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}
