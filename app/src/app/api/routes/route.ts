import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * GET /api/routes[?plannedSessionId=] — the athlete's cached suggested routes,
 * newest first, owner-scoped (RLS). Optionally filtered by planned session.
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const plannedSessionId = searchParams.get('plannedSessionId')

  let query = supabase
    .from('suggested_routes')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (plannedSessionId) {
    query = query.eq('planned_session_id', plannedSessionId)
  }

  const { data: routes, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ routes: routes ?? [] })
}
