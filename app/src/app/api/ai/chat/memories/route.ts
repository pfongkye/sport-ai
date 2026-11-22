import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listCoachMemories } from '@/lib/ai/chat-sessions/memories'

export const runtime = 'nodejs'

/** GET /api/ai/chat/memories: summaries the athlete kept from deleted chats, newest first. */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ memories: await listCoachMemories(supabase, user.id) })
}
