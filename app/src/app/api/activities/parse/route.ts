import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseActivity } from '@/lib/ai/parse-activity'

export const runtime = 'nodejs'
export const maxDuration = 30

const MAX_TEXT_CHARS = 2_000

/**
 * POST /api/activities/parse
 * Body: { text, clientNow?, tz? }
 * Returns { draft } — a structured ActivityDraft parsed from free text.
 * Read-only: performs NO database write. The confirmed draft is saved via
 * POST /api/activities after the athlete reviews/edits it.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { text?: string; clientNow?: string; tz?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const text = (body.text ?? '').toString().slice(0, MAX_TEXT_CHARS).trim()
  if (!text) {
    return NextResponse.json({ error: 'No text provided' }, { status: 400 })
  }

  const draft = await parseActivity(text, {
    userId: user.id,
    clientNow: body.clientNow,
    tz: body.tz,
  })

  return NextResponse.json({ draft })
}
