import { describe, it, expect } from 'vitest'
import { stravaToNormalized, stravaExternalId } from './strava'
import type { StravaActivity, StravaStreamSet } from '@/lib/integrations/strava/client'

/**
 * Characterization tests for the Strava → NormalizedActivity mapping. These pin
 * the dedup id, sport normalisation, pace derivation, and stream conversion so
 * the AI SDK upgrade (which doesn't touch this file) can't silently change it.
 */

const baseActivity: StravaActivity = {
  id: 123456,
  name: 'Morning Run',
  type: 'Run',
  sport_type: 'Run',
  start_date: '2026-01-01T06:00:00Z',
  elapsed_time: 1900,
  moving_time: 1800,
  distance: 5000,
  total_elevation_gain: 42,
  average_heartrate: 150,
  max_heartrate: 170,
  average_cadence: 85,
  average_speed: 2.78,
  calories: 320,
}

describe('stravaExternalId', () => {
  it('is deterministic and prefixed', () => {
    expect(stravaExternalId(123456)).toBe('strava_123456')
    expect(stravaExternalId('123456')).toBe('strava_123456')
  })
})

describe('stravaToNormalized', () => {
  it('maps summary fields and sets the dedup external_id', () => {
    const n = stravaToNormalized(baseActivity)
    expect(n.source).toBe('strava')
    expect(n.externalId).toBe('strava_123456')
    expect(n.sportType).toBe('run')
    expect(n.startedAt.toISOString()).toBe('2026-01-01T06:00:00.000Z')
    expect(n.durationS).toBe(1800) // prefers moving_time
    expect(n.distanceM).toBe(5000)
    expect(n.avgHrBpm).toBe(150)
    expect(n.maxHrBpm).toBe(170)
    expect(n.caloriesKcal).toBe(320)
    expect(n.elevationGainM).toBe(42)
    expect(n.notes).toBe('Morning Run')
    expect(n.rawData).toMatchObject({ format: 'strava', stravaId: 123456 })
  })

  it('derives avg pace from distance/moving_time (5000m / 1800s = 360 s/km)', () => {
    const n = stravaToNormalized(baseActivity)
    expect(n.avgPaceSPerKm).toBe(360)
  })

  it('normalises various sport_type values', () => {
    expect(stravaToNormalized({ ...baseActivity, sport_type: 'TrailRun', type: 'Run' }).sportType).toBe('run')
    expect(stravaToNormalized({ ...baseActivity, sport_type: 'Ride', type: 'Ride' }).sportType).toBe('cycle')
    expect(stravaToNormalized({ ...baseActivity, sport_type: 'WeightTraining', type: 'Workout' }).sportType).toBe('gym')
  })

  it('converts time-aligned streams into { t, v } points', () => {
    const streams: StravaStreamSet = {
      time: { data: [0, 1, 2] },
      heartrate: { data: [140, 150, 160] },
      latlng: { data: [[0, 0], [0.001, 0], [0.002, 0]] },
      altitude: { data: [10, 12, 11] },
    }
    const n = stravaToNormalized(baseActivity, streams)
    const hr = n.streams.find((s) => s.type === 'heartrate')
    expect(hr?.data).toEqual([
      { t: 0, v: 140 },
      { t: 1, v: 150 },
      { t: 2, v: 160 },
    ])
    const ll = n.streams.find((s) => s.type === 'latlng')
    expect(ll?.data[0]).toEqual({ t: 0, v: [0, 0] })
    expect(n.streams.some((s) => s.type === 'altitude')).toBe(true)
  })

  it('handles a missing distance (manual/stationary) without dividing by zero', () => {
    const n = stravaToNormalized({ ...baseActivity, distance: 0, average_speed: 0 })
    expect(n.distanceM).toBeUndefined()
    expect(n.avgPaceSPerKm).toBeUndefined()
  })
})
