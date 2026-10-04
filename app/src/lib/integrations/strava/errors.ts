import {
  STRAVA_ATHLETE_LIMIT,
  STRAVA_RATE_LIMITED,
  STRAVA_UNAUTHORIZED,
} from './client'

/** Not-connected is thrown by the token manager, not the HTTP client. */
export const STRAVA_NOT_CONNECTED = 'STRAVA_NOT_CONNECTED'

/** Map Strava sentinel errors to a user-facing message + HTTP status. */
export function stravaErrorResponse(err: unknown): { status: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg === STRAVA_NOT_CONNECTED) {
    return { status: 409, message: 'Strava is not connected. Connect it in Settings first.' }
  }
  if (msg === STRAVA_UNAUTHORIZED) {
    return {
      status: 401,
      message: 'Strava access was revoked or expired. Reconnect Strava in Settings.',
    }
  }
  if (msg === STRAVA_ATHLETE_LIMIT) {
    return {
      status: 403,
      message:
        "This app has reached its Strava connected-athlete limit. The app owner needs to raise the athlete cap in the Strava API settings dashboard (strava.com/settings/api).",
    }
  }
  if (msg === STRAVA_RATE_LIMITED) {
    return { status: 429, message: 'Strava rate limit hit. Try again in a few minutes.' }
  }
  return { status: 500, message: msg || 'Strava request failed' }
}
