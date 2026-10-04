import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { deleteConnection } from '@/lib/integrations/strava/tokens'

export const runtime = 'nodejs'

/**
 * POST /api/integrations/strava/disconnect
 * Removes the user's stored Strava tokens. Imported activities are kept.
 */
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await deleteConnection(supabase, user.id)
    return NextResponse.json({ disconnected: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to disconnect' },
      { status: 500 }
    )
  }
}
