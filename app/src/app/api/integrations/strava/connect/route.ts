import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { buildAuthorizeUrl } from '@/lib/integrations/strava/client'
import { stravaRedirectUri } from '@/lib/integrations/strava/oauth-url'

export const runtime = 'nodejs'

/**
 * GET /api/integrations/strava/connect
 * Starts the Strava OAuth flow: sets a short-lived CSRF `state` cookie and
 * redirects the user to Strava's consent screen. The callback verifies state.
 *
 * This is a DATA connect (import activities), NOT login — the user is already
 * authenticated here.
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let authorizeUrl: string
  const state = randomBytes(16).toString('hex')
  try {
    authorizeUrl = buildAuthorizeUrl(stravaRedirectUri(request), state)
  } catch (err) {
    // Strava creds not configured.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Strava not configured' },
      { status: 500 }
    )
  }

  const res = NextResponse.redirect(authorizeUrl)
  res.cookies.set('strava_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  })
  return res
}
