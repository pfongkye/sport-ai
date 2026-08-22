import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/activities/[id] — full activity + all streams.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: activity, error } = await supabase
    .from('activities')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !activity) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: streams } = await supabase
    .from('activity_streams')
    .select('stream_type, data')
    .eq('activity_id', id)
    .eq('user_id', user.id)

  return NextResponse.json({ activity, streams: streams ?? [] })
}

/**
 * DELETE /api/activities/[id] — removes the activity (streams cascade) and
 * cleans up the stored raw file.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Grab file_url first so we can remove the stored object.
  const { data: activity } = await supabase
    .from('activities')
    .select('file_url')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  const { error } = await supabase
    .from('activities')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (activity?.file_url) {
    await supabase.storage.from('activities').remove([activity.file_url])
  }

  return NextResponse.json({ success: true })
}
