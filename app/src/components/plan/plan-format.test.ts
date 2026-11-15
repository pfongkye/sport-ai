import { describe, it, expect, afterEach, vi } from 'vitest'
import { dayLabel, weekLabel } from './plan-format'

describe('plan date labels never shift with the viewer zone', () => {
  const original = process.env.TZ
  afterEach(() => {
    process.env.TZ = original
    vi.resetModules()
  })
  it('formats a plain date as the same day for a negative-offset runtime zone', () => {
    process.env.TZ = 'Pacific/Honolulu'
    expect(dayLabel('2026-10-12')).toBe('Mon 12 Oct')
    expect(weekLabel('2026-10-12', '2026-10-18')).toBe('12 Oct – 18 Oct')
  })
  it('formats the same for a positive-offset runtime zone', () => {
    process.env.TZ = 'Pacific/Auckland'
    expect(dayLabel('2026-10-12')).toBe('Mon 12 Oct')
  })
})
