import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { importStravaActivities } from '@/lib/integrations/strava/sync'
import { stravaErrorResponse } from '@/lib/integrations/strava/errors'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/integrations/strava/import
 * Body (all optional):
 *   { activityIds?: number[], limit?: number, withStreams?: boolean }
 * - activityIds: import exactly these Strava activity ids (from the picker).
 * - limit: otherwise import the most recent N (default 10).
 * Duplicates are skipped (dedup by external_id). Returns per-item results.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { activityIds?: unknown; limit?: unknown; withStreams?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    // empty body = import recent with defaults
  }

  const activityIds = Array.isArray(body.activityIds)
    ? body.activityIds.map(Number).filter((n) => Number.isFinite(n))
    : undefined
  const limit = typeof body.limit === 'number' ? body.limit : undefined
  const withStreams = typeof body.withStreams === 'boolean' ? body.withStreams : undefined

  try {
    const admin = await createAdminClient()
    const result = await importStravaActivities(admin, user.id, {
      activityIds,
      limit,
      withStreams,
    })
    return NextResponse.json(result, { status: result.imported > 0 ? 201 : 200 })
  } catch (err) {
    const { status, message } = stravaErrorResponse(err)
    return NextResponse.json({ error: message }, { status })
  }
}
