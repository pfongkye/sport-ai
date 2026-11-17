import { describe, it, expect, vi } from 'vitest'
import { loadActiveRace, summarizeActiveRace } from './active-race'
import { buildCoachSystemPrompt } from '@/lib/ai/prompts/coach'

describe('summarizeActiveRace', () => {
  it('is null without a plan or a structured race', () => {
    expect(summarizeActiveRace(null)).toBeNull()
    expect(summarizeActiveRace({ constraints: null, end_date: '2026-12-06' })).toBeNull()
    expect(summarizeActiveRace({ constraints: { notes: 'x' }, end_date: '2026-12-06' })).toBeNull()
    expect(summarizeActiveRace({ constraints: 'garbage', end_date: '2026-12-06' })).toBeNull()
  })

  it('reads the race, the end date and the effective limits', () => {
    const r = summarizeActiveRace({
      constraints: { race: { distance: '10k', targetTimeS: 2400 }, limits: { maxLongRunKm: 15 } },
      end_date: '2026-12-06',
    })
    expect(r).toMatchObject({ distanceKm: 10, date: '2026-12-06', targetTimeS: 2400 })
    expect(r?.limits).toMatchObject({ maxWeeklyKm: 55, maxLongRunKm: 15 })
  })
})

describe('coach prompt active race block', () => {
  const base = { profile: null, settings: null, readiness: null, today: '2026-10-12' }

  it('is absent without an active race and still asks about the distance', () => {
    const p = buildCoachSystemPrompt(base)
    expect(p).not.toContain('## Active race goal')
    expect(p).toMatch(/ASK for the\s+race distance/)
  })

  it('states the active race and limits and ties advice to the distance', () => {
    const activeRace = summarizeActiveRace({
      constraints: { race: { distance: '10k', targetTimeS: 2400 } },
      end_date: '2026-12-06',
    })
    const p = buildCoachSystemPrompt({ ...base, activeRace })
    expect(p).toContain('## Active race goal')
    expect(p).toContain('Race: 10 km on 2026-12-06 (sunday), goal time 40:00 (4:00/km)')
    expect(p).toContain('peak weekly 55 km, longest run 18 km, taper about 8 days')
    expect(p).toMatch(/MUST fit THIS distance/)
  })
})

describe('loadActiveRace', () => {
  it('logs and returns null when the lookup fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = () => chain
    chain.maybeSingle = async () => ({ data: null, error: { message: 'boom' } })
    const supabase = { from: () => chain } as never
    expect(await loadActiveRace(supabase, 'u1')).toBeNull()
    expect(spy).toHaveBeenCalledWith('[active-race] lookup failed', 'boom')
    spy.mockRestore()
  })
})
