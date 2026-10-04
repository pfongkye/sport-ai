'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

interface LoginFormProps {
  redirectTo?: string
}

/**
 * Auth is Google-only for now. Other social providers (Apple/Facebook) and
 * email are intentionally not offered — enabling one means wiring the matching
 * GOTRUE_EXTERNAL_* provider in docker-compose (see AGENTS.md gotcha #7).
 *
 * NOTE: Strava is NOT a login provider. Strava is a per-user DATA integration
 * (connect in Settings) used to import activities — see the Strava connect
 * flow under /api/integrations/strava. Don't add a "Sign in with Strava"
 * button here.
 */
const GoogleIcon = (
  <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
)

export function LoginForm({ redirectTo }: LoginFormProps) {
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  async function signInWithGoogle() {
    setLoading(true)
    const redirectUrl = `${window.location.origin}/api/auth/callback${redirectTo ? `?next=${encodeURIComponent(redirectTo)}` : ''}`

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectUrl },
    })

    if (error) {
      setLoading(false)
      console.error('OAuth error:', error.message)
    }
    // On success, browser redirects — no need to reset loading
  }

  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        className="w-full h-11 gap-3 font-medium"
        onClick={signInWithGoogle}
        disabled={loading}
        aria-label="Sign in with Google"
      >
        {loading ? (
          <svg
            className="size-4 animate-spin text-[var(--muted-foreground)]"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          GoogleIcon
        )}
        Continue with Google
      </Button>
    </div>
  )
}
