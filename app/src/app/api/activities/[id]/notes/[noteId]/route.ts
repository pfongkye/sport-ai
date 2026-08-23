import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * DELETE /api/activities/[id]/notes/[noteId]
 * Removes a note and its mirrored coaching_messages row.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const { id, noteId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch the note (scoped to user + activity) to get its mirror message id
  const { data: note } = await supabase
    .from('activity_notes')
    .select('id, message_id')
    .eq('id', noteId)
    .eq('user_id', user.id)
    .eq('activity_id', id)
    .single()

  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await supabase
    .from('activity_notes')
    .delete()
    .eq('id', noteId)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Clean up the RAG mirror
  if (note.message_id) {
    await supabase.from('coaching_messages').delete().eq('id', note.message_id).eq('user_id', user.id)
  }

  return NextResponse.json({ success: true })
}
