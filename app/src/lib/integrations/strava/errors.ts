/** Map Strava sentinel errors to a user-facing message + HTTP status. */
export function stravaErrorResponse(err: unknown): { status: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg === 'STRAVA_NOT_CONNECTED') {
    return { status: 409, message: 'Strava is not connected. Connect it in Settings first.' }
  }
  if (msg === 'STRAVA_UNAUTHORIZED') {
    return {
      status: 401,
      message: 'Strava access was revoked or expired. Reconnect Strava in Settings.',
    }
  }
  if (msg === 'STRAVA_RATE_LIMITED') {
    return { status: 429, message: 'Strava rate limit hit. Try again in a few minutes.' }
  }
  return { status: 500, message: msg || 'Strava request failed' }
}
