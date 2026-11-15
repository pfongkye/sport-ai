import { describe, it, expect } from 'vitest'
import { buildRecapView } from './recap-format'
import { computeTrainingRecap } from '@/lib/ai/workflows/training-recap'

const run = (date: string, km: number) => ({
  sport_type: 'run',
  started_at: `${date}T07:00:00Z`,
  distance_m: km * 1000,
  duration_s: km * 360,
  avg_hr_bpm: 140,
  max_hr_bpm: 190,
})

describe('buildRecapView', () => {
  it('lists used and excluded weeks with reasons and the key facts', () => {
    const acts = [['2026-09-14', '2026-09-17'], ['2026-09-21', '2026-09-24'], ['2026-09-28', '2026-10-01']].flatMap((d) => d.map((x) => run(x, 8)))
    const v = buildRecapView(computeTrainingRecap(acts, { timezone: 'UTC' }, '2026-10-12'))
    expect(v.weeks).toHaveLength(6)
    expect(v.weeks.filter((w) => w.used)).toHaveLength(3)
    expect(v.weeks[0]).toMatchObject({ used: false, detail: 'Not used: no activity' })
    expect(v.weeks[2].detail).toBe('16 km · 2 runs')
    expect(v.summary).toBe('3 of 6 recent weeks used')
    expect(v.facts.find((f) => f.label === 'Typical easy pace')?.value).toBe('6:00 /km')
    expect(v.facts.find((f) => f.label === 'Typical long run')?.value).toBe('8 km at 6:00 /km')
  })
  it('flags limited history and shows "Not available" instead of guessing', () => {
    const v = buildRecapView(computeTrainingRecap([], { timezone: 'UTC' }, '2026-10-12'))
    expect(v.summary).toMatch(/0 of 6 recent weeks used .*conservatively/)
    expect(v.facts[0].value).toBe('12 km (estimated from your training days)')
    expect(v.facts.find((f) => f.label === 'Intensity split')?.value).toBe('Not available')
    expect(v.notes.length).toBeGreaterThan(0)
  })
})
