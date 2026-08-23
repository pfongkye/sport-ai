import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * GET /api/activities/[id]/notes
 * List all notes for an activity (chronological). One session → many notes.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('activity_notes')
    .select('id, transcript, source, duration_s, created_at')
    .eq('user_id', user.id)
    .eq('activity_id', id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ notes: data ?? [] })
}

/**
 * POST /api/activities/[id]/notes
 * Body: { transcript: string, source?: 'voice'|'text', durationS?: number }
 * Creates a note (transcript-only) and mirrors an embedded copy into
 * coaching_messages (kind='session_voice_note') for RAG.
 *
 * The client transcribes voice via /api/ai/voice/transcribe first and lets the
 * athlete EDIT the text; this endpoint only ever receives final text.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify the activity belongs to the user
  const { data: activity } = await supabase
    .from('activities')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (!activity) return NextResponse.json({ error: 'Activity not found' }, { status: 404 })

  let body: { transcript?: string; source?: string; durationS?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const transcript = (body.transcript ?? '').trim()
  if (!transcript) return NextResponse.json({ error: 'Empty note' }, { status: 400 })
  if (transcript.length > 5000) {
    return NextResponse.json({ error: 'Note too long (max 5000 chars)' }, { status: 400 })
  }
  const source = body.source === 'text' ? 'text' : 'voice'

  // Mirror into coaching_messages for RAG retrieval (embedding populated in Task 2.10).
  const { data: message } = await supabase
    .from('coaching_messages')
    .insert({
      user_id: user.id,
      role: 'user',
      content: transcript,
      metadata: { kind: 'session_voice_note', activity_id: id },
    })
    .select('id')
    .single()

  const { data: note, error } = await supabase
    .from('activity_notes')
    .insert({
      user_id: user.id,
      activity_id: id,
      transcript,
      source,
      duration_s: body.durationS ?? null,
      audio_url: null, // transcript-only by default
      message_id: message?.id ?? null,
    })
    .select('id, transcript, source, duration_s, created_at')
    .single()

  if (error || !note) {
    // Roll back the mirror if the note insert failed
    if (message?.id) await supabase.from('coaching_messages').delete().eq('id', message.id)
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  }

  return NextResponse.json({ note }, { status: 201 })
}
