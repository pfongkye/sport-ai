import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createChatSession, listChatSessions } from '@/lib/ai/chat-sessions/sessions'

export const runtime = 'nodejs'

/** GET /api/ai/chat/sessions: the caller's chats, newest first (max 50). */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ sessions: await listChatSessions(supabase, user.id) })
}

/** POST /api/ai/chat/sessions: start a new empty chat. */
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await createChatSession(supabase, user.id)
  if (!session) return NextResponse.json({ error: 'Could not create the chat.' }, { status: 500 })
  return NextResponse.json({ session }, { status: 201 })
}
