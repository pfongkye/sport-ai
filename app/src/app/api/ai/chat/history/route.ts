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

  const { data, error } = await supabase
    .from('coaching_messages')
    .select('id, role, content, metadata, created_at')
    .eq('user_id', user.id)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Return chronological order for display
  const messages = (data ?? []).reverse()
  return NextResponse.json({ messages })
}
