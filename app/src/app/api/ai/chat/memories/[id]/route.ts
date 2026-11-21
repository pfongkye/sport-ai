import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  MAX_MEMORY_SUMMARY_CHARS,
  MAX_MEMORY_TITLE_CHARS,
} from '@/lib/ai/chat-sessions/memories'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

/** PATCH /api/ai/chat/memories/[id]: edit summary (max 2000 chars) and/or title (max 120). */
export async function PATCH(request: Request, { params }: Ctx) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { summary?: unknown; title?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const update: { summary?: string; title?: string; updated_at: string } = {
    updated_at: new Date().toISOString(),
  }
  if (body.summary !== undefined) {
    if (typeof body.summary !== 'string' || !body.summary.trim() || body.summary.length > MAX_MEMORY_SUMMARY_CHARS) {
      return NextResponse.json(
        { error: `Summary must be 1-${MAX_MEMORY_SUMMARY_CHARS} characters.` },
        { status: 400 }
      )
    }
    update.summary = body.summary.trim()
  }
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > MAX_MEMORY_TITLE_CHARS) {
      return NextResponse.json(
        { error: `Title must be 1-${MAX_MEMORY_TITLE_CHARS} characters.` },
        { status: 400 }
      )
    }
    update.title = body.title.trim()
  }
  if (update.summary === undefined && update.title === undefined) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const { id } = await params
  const { data, error } = await supabase
    .from('coach_memories')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, title, summary, message_count, source_started_at, source_ended_at, created_at, updated_at')
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'Could not update the memory.' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Memory not found.' }, { status: 404 })
  return NextResponse.json({ memory: data })
}

/** DELETE /api/ai/chat/memories/[id] */
export async function DELETE(_request: Request, { params }: Ctx) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data, error } = await supabase
    .from('coach_memories')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'Could not delete the memory.' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Memory not found.' }, { status: 404 })
  return NextResponse.json({ deleted: id })
}
