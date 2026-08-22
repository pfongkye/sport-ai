import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Resolves the public-facing origin for redirects.
 *
 * Behind a proxy/tunnel (ngrok), `new URL(request.url).origin` is the INTERNAL
 * address the Next.js server received the request on (http://localhost:3000),
 * not the public URL the user is on. That makes post-login redirects bounce to
 * localhost instead of the ngrok URL.
 *
 * Resolution order:
 *  1. x-forwarded-host / x-forwarded-proto (set by ngrok and most proxies)
 *  2. NEXT_PUBLIC_APP_URL (explicit public base, set by ngrok-sync.sh)
 *  3. request.url origin (plain localhost dev)
 */
function resolvePublicOrigin(request: Request): string {
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https'
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`
  }
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL
  }
  return new URL(request.url).origin
}

/**
 * OAuth callback handler.
 * Supabase redirects here after social login.
 * Exchanges the code for a session, then redirects to the app.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'
  const origin = resolvePublicOrigin(request)

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      console.error('[auth/callback] exchangeCodeForSession failed:', {
        message: error.message,
        status: error.status,
        code: error.code,
      })
    }

    if (!error) {
      // Check if user has completed onboarding
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('display_name, primary_goal')
          .eq('id', user.id)
          .single()

        // New user or incomplete profile → onboarding
        if (!profile?.display_name || !profile?.primary_goal) {
          return NextResponse.redirect(`${origin}/onboarding`)
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
