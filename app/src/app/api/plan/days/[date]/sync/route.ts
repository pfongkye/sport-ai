import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { syncPlanDay } from '@/lib/plan/sync-day'
import { getAthleteTimezone } from '@/lib/plan/session-guard'
import { tzFromCookieHeader } from '@/lib/plan/timezone'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/plan/days/[date]/sync
 * Imports the athlete-local day's Strava activities (when connected; duplicates
 * skipped) and returns { date, strava, imported, activities }. 400 for an
 * invalid or future date. Strava errors are reported in `strava`, never as a failure.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ date: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { date } = await params
  try {
    const tz = await getAthleteTimezone(
      supabase,
      user.id,
      tzFromCookieHeader(request.headers.get('cookie'))
    )
    const admin = await createAdminClient()
    const result = await syncPlanDay(supabase, admin, user.id, date, tz)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    const { ok: _ok, ...body } = result
    void _ok
    return NextResponse.json(body)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 }
    )
  }
}
