import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { exchangeCodeForToken, STRAVA_SCOPE } from '@/lib/integrations/strava/client'
import { saveConnection } from '@/lib/integrations/strava/tokens'
import { resolvePublicOrigin } from '@/lib/integrations/strava/oauth-url'

export const runtime = 'nodejs'

/**
 * GET /api/integrations/strava/callback
 * Strava redirects here after the consent screen. We verify the CSRF state
 * cookie, exchange the code for tokens, store them encrypted, and bounce the
 * user back to Settings.
 */
export async function GET(request: Request) {
  const origin = resolvePublicOrigin(request)
  const settingsUrl = (status: string) => `${origin}/settings?strava=${status}`

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error') // e.g. "access_denied"
  const state = searchParams.get('state')
  const expectedState = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('strava_oauth_state='))
    ?.split('=')[1]

  // Clear the state cookie on every outcome.
  const clearState = (res: NextResponse) => {
    res.cookies.set('strava_oauth_state', '', { path: '/', maxAge: 0 })
    return res
  }

  if (error) {
    return clearState(NextResponse.redirect(settingsUrl('denied')))
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return clearState(NextResponse.redirect(settingsUrl('invalid_state')))
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return clearState(NextResponse.redirect(`${origin}/login`))
  }

  try {
    const token = await exchangeCodeForToken(code)
    const admin = await createAdminClient()
    // Strava doesn't echo scope — stamp what we requested.
    await saveConnection(admin, user.id, {
      ...token,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scope: STRAVA_SCOPE,
    } as any)
    return clearState(NextResponse.redirect(settingsUrl('connected')))
  } catch (err) {
    console.error('[strava/callback] token exchange failed', err)
    return clearState(NextResponse.redirect(settingsUrl('error')))
  }
}
