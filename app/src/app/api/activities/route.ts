import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { activityDraftSchema } from '@/lib/activities/draft-schema'
import { insertManualActivity, findLikelyDuplicate } from '@/lib/activities/insert-manual'

export const runtime = 'nodejs'

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

/**
 * POST /api/activities
 * Body: a confirmed ActivityDraft (see draft-schema) plus optional `force`.
 * Creates a manual activity (source:'manual', no file, no streams).
 *
 * Dedup (spec Req 4.5): manual entries have no external_id, so before inserting
 * we look for an existing activity of the same sport within ±90 min. If found
 * and `force` is not set, respond 409 with the candidate so the UI can offer
 * "save anyway".
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const force = Boolean((body as { force?: unknown } | null)?.force)

  const parsed = activityDraftSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const field = first?.path?.[0]
    return NextResponse.json(
      {
        error: 'Invalid activity',
        field: typeof field === 'string' ? field : undefined,
        message: first?.message,
      },
      { status: 400 }
    )
  }
  const draft = parsed.data

  if (!force) {
    const dup = await findLikelyDuplicate(supabase, user.id, {
      sportType: draft.sportType,
      startedAt: draft.startedAt,
    })
    if (dup) {
      return NextResponse.json(
        { error: 'possible_duplicate', duplicate: dup },
        { status: 409 }
      )
    }
  }

  try {
    const { id } = await insertManualActivity(supabase, user.id, draft)
    return NextResponse.json({ id }, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save activity' },
      { status: 500 }
    )
  }
}
