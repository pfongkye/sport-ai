import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseActivityFile, isSupportedFormat } from '@/lib/importers'
import { insertNormalizedActivity } from '@/lib/activities/insert-normalized'
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

      // Shared write path: dedup by (user_id, external_id), store raw file,
      // insert activity + streams.
      const result = await insertNormalizedActivity(supabase, user.id, activity, {
        buffer,
        filename: file.name,
      })

      results.push({
        filename: file.name,
        status: result.status,
        activityId: result.activityId,
        message: result.status === 'duplicate' ? 'Already uploaded' : result.message,
      })
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
