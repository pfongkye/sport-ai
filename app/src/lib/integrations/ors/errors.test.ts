import { describe, it, expect } from 'vitest'
import { orsErrorResponse } from './errors'
import {
  classifyOrsError,
  ORS_NO_ROUTE,
  ORS_RATE_LIMITED,
  ORS_TIMEOUT,
  ORS_UNAUTHORIZED,
  ORS_UNAVAILABLE,
} from './client'
import { NO_LOCATION } from './suggest'

/** classifyOrsError maps HTTP status/body → the right sentinel (or null). */
describe('classifyOrsError', () => {
  it('maps 429 to ORS_RATE_LIMITED', () => {
    expect(classifyOrsError(429, '')?.message).toBe(ORS_RATE_LIMITED)
  })

  it('maps 401 and 403 to ORS_UNAUTHORIZED', () => {
    expect(classifyOrsError(401, '')?.message).toBe(ORS_UNAUTHORIZED)
    expect(classifyOrsError(403, '')?.message).toBe(ORS_UNAUTHORIZED)
  })

  it('maps 404 to ORS_NO_ROUTE', () => {
    expect(classifyOrsError(404, '')?.message).toBe(ORS_NO_ROUTE)
  })

  it('maps 5xx to ORS_UNAVAILABLE', () => {
    expect(classifyOrsError(500, '')?.message).toBe(ORS_UNAVAILABLE)
    expect(classifyOrsError(503, '')?.message).toBe(ORS_UNAVAILABLE)
  })

  it('maps a 4xx routing error body to ORS_NO_ROUTE', () => {
    expect(classifyOrsError(400, 'Could not find routable point')?.message).toBe(ORS_NO_ROUTE)
    expect(classifyOrsError(400, 'error code 2010')?.message).toBe(ORS_NO_ROUTE)
  })

  it('returns null for an unclassified 4xx', () => {
    expect(classifyOrsError(400, 'some other error')).toBeNull()
  })
})

/** Pins the ORS sentinel → {status, message} mapping used by the API routes. */
describe('orsErrorResponse', () => {
  it('maps NO_LOCATION to 422 with a location hint', () => {
    const r = orsErrorResponse(new Error(NO_LOCATION))
    expect(r.status).toBe(422)
    expect(r.message).toMatch(/location|where/i)
  })

  it('maps ORS_NO_ROUTE to 422 with a try-different hint', () => {
    const r = orsErrorResponse(new Error(ORS_NO_ROUTE))
    expect(r.status).toBe(422)
    expect(r.message).toMatch(/different distance|start point/i)
  })

  it('maps ORS_RATE_LIMITED to 429', () => {
    const r = orsErrorResponse(new Error(ORS_RATE_LIMITED))
    expect(r.status).toBe(429)
    expect(r.message).toMatch(/busy|try again/i)
  })

  it('maps ORS_UNAUTHORIZED to 500 with an owner-action hint', () => {
    const r = orsErrorResponse(new Error(ORS_UNAUTHORIZED))
    expect(r.status).toBe(500)
    expect(r.message).toMatch(/owner|ORS/i)
  })

  it('maps ORS_TIMEOUT to 504', () => {
    const r = orsErrorResponse(new Error(ORS_TIMEOUT))
    expect(r.status).toBe(504)
    expect(r.message).toMatch(/timed out/i)
  })

  it('maps ORS_UNAVAILABLE to 502', () => {
    const r = orsErrorResponse(new Error(ORS_UNAVAILABLE))
    expect(r.status).toBe(502)
    expect(r.message).toMatch(/unavailable/i)
  })

  it('falls back to 500 for an unknown error', () => {
    const r = orsErrorResponse(new Error('something odd'))
    expect(r.status).toBe(500)
    expect(r.message).toBe('something odd')
  })
})
