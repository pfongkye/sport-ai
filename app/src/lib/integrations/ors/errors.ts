import {
  ORS_NO_ROUTE,
  ORS_RATE_LIMITED,
  ORS_TIMEOUT,
  ORS_UNAUTHORIZED,
  ORS_UNAVAILABLE,
} from './client'
import { NO_LOCATION } from './suggest'

/** Map ORS sentinel errors to a user-facing message + HTTP status. */
export function orsErrorResponse(err: unknown): { status: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg === NO_LOCATION) {
    return {
      status: 422,
      message: 'I need a start location — share your location or tell me where to run.',
    }
  }
  if (msg === ORS_NO_ROUTE) {
    return {
      status: 422,
      message: "Couldn't find a runnable loop there — try a different distance or start point.",
    }
  }
  if (msg === ORS_RATE_LIMITED) {
    return { status: 429, message: 'Routing is busy right now. Try again in a minute.' }
  }
  if (msg === ORS_UNAUTHORIZED) {
    // Owner-fixable (like the Strava athlete-limit): the app owner sets the key.
    return {
      status: 500,
      message: "Routing isn't configured — the app owner needs to set the ORS API key.",
    }
  }
  if (msg === ORS_TIMEOUT) {
    return { status: 504, message: 'Routing timed out. Try again.' }
  }
  if (msg === ORS_UNAVAILABLE) {
    return { status: 502, message: 'Routing is temporarily unavailable. Try again shortly.' }
  }
  return { status: 500, message: msg || 'Route suggestion failed' }
}
