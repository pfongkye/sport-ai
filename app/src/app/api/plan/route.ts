import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadActivePlan } from '@/lib/plan/load-plan'
import { tzFromCookieHeader } from '@/lib/plan/timezone'

export const runtime = 'nodejs'

/** GET /api/plan → { plan, sessions, today, timezone } for the active plan, or { plan: null }. */
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const active = await loadActivePlan(
      supabase,
      user.id,
      new Date(),
      tzFromCookieHeader(request.headers.get('cookie'))
    )
    if (!active) return NextResponse.json({ plan: null })
    return NextResponse.json(active)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load plan' },
      { status: 500 }
    )
  }
}
