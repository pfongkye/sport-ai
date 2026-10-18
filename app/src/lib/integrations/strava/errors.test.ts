import { describe, it, expect } from 'vitest'
import { stravaErrorResponse, STRAVA_NOT_CONNECTED } from './errors'
import {
  STRAVA_ATHLETE_LIMIT,
  STRAVA_RATE_LIMITED,
  STRAVA_UNAUTHORIZED,
} from './client'

/** Pins the Strava sentinel → {status, message} mapping used by the API routes. */
describe('stravaErrorResponse', () => {
  it('maps not-connected to 409', () => {
    const r = stravaErrorResponse(new Error(STRAVA_NOT_CONNECTED))
    expect(r.status).toBe(409)
    expect(r.message).toMatch(/not connected/i)
  })

  it('maps unauthorized to 401 with a reconnect hint', () => {
    const r = stravaErrorResponse(new Error(STRAVA_UNAUTHORIZED))
    expect(r.status).toBe(401)
    expect(r.message).toMatch(/reconnect/i)
  })

  it('maps the athlete-limit to 403 with an owner-action hint', () => {
    const r = stravaErrorResponse(new Error(STRAVA_ATHLETE_LIMIT))
    expect(r.status).toBe(403)
    expect(r.message).toMatch(/athlete limit|athlete cap|connected-athlete/i)
  })

  it('maps rate-limited to 429', () => {
    const r = stravaErrorResponse(new Error(STRAVA_RATE_LIMITED))
    expect(r.status).toBe(429)
    expect(r.message).toMatch(/rate limit/i)
  })

  it('falls back to 500 for an unknown error', () => {
    const r = stravaErrorResponse(new Error('something odd'))
    expect(r.status).toBe(500)
    expect(r.message).toBe('something odd')
  })
})
