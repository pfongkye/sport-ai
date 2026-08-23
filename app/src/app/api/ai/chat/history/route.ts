import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/ai/chat/history?limit=50
 * Returns recent coaching messages (oldest→newest) for the current user.
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 200)

  // Chat history shows ONLY chat-kind messages. Other kinds live in the same
  // coaching_messages table for RAG (post_session_insight, session_voice_note,
  // future nutrition_insight, ...) and must NOT surface in the chat feed.
  //
  // Allowlist (kind = 'chat') is future-proof: any new mirrored kind is excluded
  // automatically without touching this filter. Migration 009 backfilled all
  // legacy chat rows to kind='chat', so nothing genuine is missed.
  const { data, error } = await supabase
    .from('coaching_messages')
    .select('id, role, content, metadata, created_at')
    .eq('user_id', user.id)
    .in('role', ['user', 'assistant'])
    .eq('metadata->>kind', 'chat')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Return chronological order for display
  const messages = (data ?? []).reverse()
  return NextResponse.json({ messages })
}
