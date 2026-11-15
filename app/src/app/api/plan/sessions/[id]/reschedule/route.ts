import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAthleteToday } from '@/lib/plan/session-guard'
import { rescheduleSession } from '@/lib/plan/reschedule'

export const runtime = 'nodejs'

/**
 * PATCH /api/plan/sessions/[id]/reschedule
 * Body: { date: 'YYYY-MM-DD' }
 * Moves one FUTURE, editable (pending or already moved, not completed) planned session owned by the caller. The client's
 * own guardrail is never trusted (spec Req 2a.4): the shared predicate is
 * re-checked here and again inside the UPDATE.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { date?: unknown }
  try {
    body = (await request.json()) as { date?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { id } = await params
  const today = await getAthleteToday(supabase, user.id)
  const result = await rescheduleSession(supabase, user.id, id, body?.date, today)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ sessionId: result.sessionId, from: result.from, to: result.to })
}
