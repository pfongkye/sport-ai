/**
 * Athlete time zone resolution (pure, no server-only imports).
 *
 * The browser zone is the source of truth. It reaches the server two ways:
 * a `tz` cookie (per request, so server components render the right day on the
 * first paint) and `user_settings.timezone` (persisted copy for code that has no
 * request, such as imports). Both are validated before use.
 */
export const TZ_COOKIE = 'tz'
export const TZ_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365

/** True when `tz` is an IANA zone this runtime understands. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim() || tz.length > 64) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Request zone: cookie (if valid) > stored setting (if valid) > 'UTC'. */
export function resolveAthleteTimeZone(input: {
  cookieTz?: string | null
  settingsTz?: string | null
}): string {
  if (isValidTimeZone(input.cookieTz)) return input.cookieTz
  if (isValidTimeZone(input.settingsTz)) return input.settingsTz
  return 'UTC'
}

/** Read the (unvalidated) `tz` cookie value out of a raw `Cookie` header. */
export function tzFromCookieHeader(header: string | null | undefined): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0 || part.slice(0, i).trim() !== TZ_COOKIE) continue
    try {
      return decodeURIComponent(part.slice(i + 1).trim()) || null
    } catch {
      return null
    }
  }
  return null
}
