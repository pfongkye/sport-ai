import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { deleteChatSession } from '@/lib/ai/chat-sessions/delete-session'
import { updateChatSessionSettings } from '@/lib/ai/chat-sessions/sessions'
import { summarizeChat } from '@/lib/ai/chat-sessions/summarize'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * DELETE /api/ai/chat/sessions/[id]?keepHistory=true|false (default false)
 * Deletes the chat and its messages. With keepHistory, one LLM summary is saved first as a
 * coach memory; if that fails nothing is deleted. Without it the LLM is never called.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const keepHistory = new URL(request.url).searchParams.get('keepHistory') === 'true'
  const result = await deleteChatSession(supabase, user.id, id, {
    keepHistory,
    summarize: (messages) => summarizeChat(user.id, messages),
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ deleted: result.deleted, memory: result.memory })
}

/** PATCH /api/ai/chat/sessions/[id] body {recallOtherChats: boolean}: per-chat memory setting. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { recallOtherChats?: unknown } | null = null
  try {
    body = await request.json()
  } catch {
    body = null
  }
  if (!body || typeof body.recallOtherChats !== 'boolean') {
    return NextResponse.json({ error: 'recallOtherChats must be a boolean' }, { status: 400 })
  }

  const { id } = await params
  const session = await updateChatSessionSettings(supabase, user.id, id, {
    recallOtherChats: body.recallOtherChats,
  })
  if (!session) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  return NextResponse.json({ session })
}
