import { describe, it, expect } from 'vitest'
import { bucketActivities, orderDayItems, type RawActivity } from './day-items'

const act = (id: string, started_at: string): RawActivity => ({
  id, sport_type: 'running', started_at, duration_s: 1800, distance_m: 5000, avg_pace_s_per_km: 360, avg_hr_bpm: 150, source: 'strava',
})
const W = { from: '2026-10-01', to: '2026-10-31' }

describe('bucketActivities', () => {
  it('drops linked ids and out-of-window activities', () => {
    const r = bucketActivities(
      [act('a', '2026-10-12T07:00:00Z'), act('b', '2026-10-13T07:00:00Z'), act('c', '2026-11-20T07:00:00Z')],
      'UTC', ['b'], W
    )
    expect(r.map((x) => x.id)).toEqual(['a'])
    expect(r[0].local_date).toBe('2026-10-12')
  })
  it('buckets by athlete-local day near midnight', () => {
    const a = act('a', '2026-10-12T23:30:00Z')
    expect(bucketActivities([a], 'Pacific/Auckland', [], W)[0].local_date).toBe('2026-10-13')
    expect(bucketActivities([a], 'America/Los_Angeles', [], W)[0].local_date).toBe('2026-10-12')
    expect(bucketActivities([a], 'UTC', [], W)[0].local_date).toBe('2026-10-12')
  })
  it('handles empty input', () => {
    expect(bucketActivities([], 'UTC', [], W)).toEqual([])
  })
})

describe('orderDayItems', () => {
  it('puts activities (by time), then completed sessions, then the rest', () => {
    const acts = bucketActivities([act('late', '2026-10-12T18:00:00Z'), act('early', '2026-10-12T06:00:00Z')], 'UTC', [], W)
    const sessions = [
      { id: 'p', status: 'pending' },
      { id: 'd', status: 'completed' },
      { id: 'm', status: 'modified' },
    ]
    const ids = orderDayItems(acts, sessions).map((i) => (i.kind === 'activity' ? i.activity.id : i.session.id))
    expect(ids).toEqual(['early', 'late', 'd', 'p', 'm'])
  })
  it('is empty with no items', () => {
    expect(orderDayItems([], [])).toEqual([])
  })
})
