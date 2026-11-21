import { describe, it, expect } from 'vitest'
import { dayBoundsEpoch } from './dates'

const iso = (s: number) => new Date(s * 1000).toISOString()

describe('dayBoundsEpoch', () => {
  it('is a 24h span in UTC', () => {
    const [a, b] = dayBoundsEpoch('2026-10-12', 'UTC')
    expect(iso(a)).toBe('2026-10-12T00:00:00.000Z')
    expect(b - a).toBe(86400)
  })
  it('offsets for a zone ahead of and behind UTC', () => {
    expect(iso(dayBoundsEpoch('2026-10-12', 'Asia/Tokyo')[0])).toBe('2026-10-11T15:00:00.000Z')
    expect(iso(dayBoundsEpoch('2026-01-12', 'America/Los_Angeles')[0])).toBe('2026-01-12T08:00:00.000Z')
  })
  it('spans 23h on the spring-forward day in Europe/Paris', () => {
    const [a, b] = dayBoundsEpoch('2026-03-29', 'Europe/Paris')
    expect(iso(a)).toBe('2026-03-28T23:00:00.000Z')
    expect(b - a).toBe(23 * 3600)
  })
  it('spans 25h on the fall-back day in Europe/Paris', () => {
    const [a, b] = dayBoundsEpoch('2026-10-25', 'Europe/Paris')
    expect(b - a).toBe(25 * 3600)
  })
  it('falls back to UTC for an invalid zone', () => {
    expect(dayBoundsEpoch('2026-10-12', 'Nope/Zone')[0]).toBe(dayBoundsEpoch('2026-10-12', 'UTC')[0])
  })
})
