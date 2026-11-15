import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { suggestRoute, type SuggestRouteOptions, type Terrain } from '@/lib/integrations/ors/suggest'
import { orsErrorResponse } from '@/lib/integrations/ors/errors'

export const runtime = 'nodejs'
// Route generation loops ORS round-trips; keep a bounded ceiling.
export const maxDuration = 30

/**
 * POST /api/routes/suggest
 * Body: { distanceKm, terrain, coord?, placeText?, browserCoord?, plannedSessionId? }
 * Resolves a start location (server-side, RLS-scoped), generates a round-trip
 * route via ORS, caches it in suggested_routes, and returns the chosen route.
 */
export async function POST(request: Request) {
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

  // ─── Validate / normalise inputs ────────────────────────────────────────
  const distanceKmRaw = Number(body.distanceKm)
  if (!Number.isFinite(distanceKmRaw) || distanceKmRaw <= 0) {
    return NextResponse.json({ error: 'distanceKm must be a positive number' }, { status: 400 })
  }
  const distanceKm = Math.min(Math.max(distanceKmRaw, 1), 60)

  const terrain: Terrain = body.terrain === 'uphill' ? 'uphill' : 'flat'

  const coord = parseCoord(body.coord)
  const browserCoord = parseCoord(body.browserCoord)
  const placeText =
    typeof body.placeText === 'string' && body.placeText.trim() ? body.placeText.trim() : null
  const plannedSessionId =
    typeof body.plannedSessionId === 'string' && body.plannedSessionId.trim()
      ? body.plannedSessionId.trim()
      : null

  // Ownership check for an attached planned session (RLS-scoped select).
  if (plannedSessionId) {
    const { data: session } = await supabase
      .from('planned_sessions')
      .select('id')
      .eq('id', plannedSessionId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!session) {
      return NextResponse.json({ error: 'Planned session not found' }, { status: 404 })
    }
  }

  const opts: SuggestRouteOptions = {
    distanceKm,
    terrain,
    coord,
    placeText,
    browserCoord,
    plannedSessionId,
  }

  try {
    const route = await suggestRoute(supabase, user.id, opts)
    return NextResponse.json({ route })
  } catch (err) {
    const { status, message } = orsErrorResponse(err)
    return NextResponse.json({ error: message }, { status })
  }
}

/** Accept a {lng,lat} object with finite numbers; otherwise null. */
function parseCoord(raw: unknown): { lng: number; lat: number } | null {
  if (!raw || typeof raw !== 'object') return null
  const { lng, lat } = raw as { lng?: unknown; lat?: unknown }
  if (
    typeof lng === 'number' &&
    typeof lat === 'number' &&
    Number.isFinite(lng) &&
    Number.isFinite(lat)
  ) {
    return { lng, lat }
  }
  return null
}
