import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { setAthleteTimezone } from '@/lib/plan/set-timezone'

export const runtime = 'nodejs'

/**
 * PATCH /api/settings/timezone
 * Body: { timeZone: 'Europe/Paris' }
 * Stores the browser's IANA zone on the caller's own user_settings row so code
 * without a request (imports, background paths) knows the athlete's zone.
 * No write when the value is unchanged.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { timeZone?: unknown }
  try {
    body = (await request.json()) as { timeZone?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = await setAthleteTimezone(supabase, user.id, body?.timeZone)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ timezone: result.timezone, changed: result.changed })
}
