import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/activities
 * Query params: limit (default 20), cursor (started_at ISO, for pagination),
 * sport (filter by sport_type), from/to (date range ISO).
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Number(searchParams.get('limit') ?? 20), 100)
  const cursor = searchParams.get('cursor')
  const sport = searchParams.get('sport')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  let query = supabase
    .from('activities')
    .select(
      'id, sport_type, source, started_at, duration_s, distance_m, elevation_gain_m, avg_hr_bpm, avg_pace_s_per_km, avg_cadence_rpm, training_load, notes'
    )
    .eq('user_id', user.id)
    .order('started_at', { ascending: false })
    .limit(limit + 1) // fetch one extra to detect next page

  if (sport) query = query.eq('sport_type', sport)
  if (from) query = query.gte('started_at', from)
  if (to) query = query.lte('started_at', to)
  if (cursor) query = query.lt('started_at', cursor)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = data ?? []
  const hasMore = rows.length > limit
  const activities = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? activities[activities.length - 1].started_at : null

  return NextResponse.json({ activities, nextCursor })
}
