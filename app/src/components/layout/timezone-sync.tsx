'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { TZ_COOKIE, TZ_COOKIE_MAX_AGE_S } from '@/lib/plan/timezone'

/**
 * Mounted once in the authenticated layout. Treats the browser's zone as the
 * source of truth: writes it to the `tz` cookie (read by server components and
 * routes on the next request) and to `user_settings.timezone` (for code with no
 * request). Writes only when the value differs, so it never loops. Renders nothing.
 */
export function TimezoneSync({ settingsTimeZone }: { settingsTimeZone: string | null }) {
  const router = useRouter()

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!tz) return

    const cookieTz = document.cookie
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${TZ_COOKIE}=`))
      ?.slice(TZ_COOKIE.length + 1)
    const cookieChanged = !cookieTz || decodeURIComponent(cookieTz) !== tz
    if (cookieChanged) {
      document.cookie = `${TZ_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=${TZ_COOKIE_MAX_AGE_S}; SameSite=Lax`
    }

    if (settingsTimeZone !== tz) {
      void fetch('/api/settings/timezone', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeZone: tz }),
      }).catch(() => {})
    }

    // Server components rendered before the cookie existed used the stored zone: re-render once.
    if (cookieChanged) router.refresh()
  }, [settingsTimeZone, router])

  return null
}
