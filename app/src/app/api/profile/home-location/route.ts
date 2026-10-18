import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const MAX_LABEL_LEN = 120

/**
 * PATCH /api/profile/home-location
 * Body: { home_lat, home_lng, home_label } — any field may be null to clear.
 * Saves the athlete's home location on their profile (RLS owner-scoped), used
 * as a fallback start point for route suggestions.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // lat/lng: null clears; otherwise finite within range. Both must agree:
  // you can't set one coordinate without the other.
  const lat = normaliseCoord(body.home_lat)
  const lng = normaliseCoord(body.home_lng)
  if (lat === 'invalid' || lng === 'invalid') {
    return NextResponse.json({ error: 'home_lat/home_lng must be numbers or null' }, { status: 400 })
  }
  if (typeof lat === 'number' && (lat < -90 || lat > 90)) {
    return NextResponse.json({ error: 'home_lat must be between -90 and 90' }, { status: 400 })
  }
  if (typeof lng === 'number' && (lng < -180 || lng > 180)) {
    return NextResponse.json({ error: 'home_lng must be between -180 and 180' }, { status: 400 })
  }
  if ((lat === null) !== (lng === null)) {
    return NextResponse.json(
      { error: 'home_lat and home_lng must be set or cleared together' },
      { status: 400 }
    )
  }

  // label: null clears; otherwise trimmed + length-capped string.
  let label: string | null
  if (body.home_label === null || body.home_label === undefined) {
    label = null
  } else if (typeof body.home_label === 'string') {
    const trimmed = body.home_label.trim()
    label = trimmed ? trimmed.slice(0, MAX_LABEL_LEN) : null
  } else {
    return NextResponse.json({ error: 'home_label must be a string or null' }, { status: 400 })
  }

  const update = { home_lat: lat, home_lng: lng, home_label: label }
  const { data, error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', user.id)
    .select('home_lat, home_lng, home_label')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

/** null (clear) | finite number | 'invalid' sentinel. */
function normaliseCoord(raw: unknown): number | null | 'invalid' {
  if (raw === null || raw === undefined) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return 'invalid'
  return n
}
