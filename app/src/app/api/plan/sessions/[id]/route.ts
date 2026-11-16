import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { deleteSession } from '@/lib/plan/delete-session'

export const runtime = 'nodejs'

/**
 * DELETE /api/plan/sessions/[id]
 * Deletes one planned session owned by the caller (not completed). 404 for unknown or
 * someone else's id, 409 for a completed session.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const result = await deleteSession(supabase, user.id, id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ sessionId: result.sessionId, date: result.date })
}
