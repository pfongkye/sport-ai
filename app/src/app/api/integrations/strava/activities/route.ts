import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { listStravaActivities } from '@/lib/integrations/strava/sync'
import { stravaErrorResponse } from '@/lib/integrations/strava/errors'

export const runtime = 'nodejs'

/**
 * GET /api/integrations/strava/activities?limit=30
 * Returns recent Strava activities with an `alreadyImported` flag so the UI can
 * let the user pick which to import (and visibly skip duplicates).
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
  const limit = Math.min(Number(searchParams.get('limit')) || 30, 100)

  try {
    const admin = await createAdminClient()
    const activities = await listStravaActivities(admin, user.id, { limit })
    return NextResponse.json({ activities })
  } catch (err) {
    const { status, message } = stravaErrorResponse(err)
    return NextResponse.json({ error: message }, { status })
  }
}
