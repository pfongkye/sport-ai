import { describe, it, expect } from 'vitest'
import { isFutureAndPending, applyFutureAndPending, getAthleteToday } from './session-guard'
import { localDateInTz, isIsoDate, addDays, mondayOf, weekdayIndex } from './dates'
import { makeFakeSupabase } from './__fixtures__/fake-supabase'

describe('dates', () => {
  it('validates real calendar dates only', () => {
    expect(isIsoDate('2026-10-12')).toBe(true)
    expect(isIsoDate('2026-02-31')).toBe(false)
    expect(isIsoDate('12/10/2026')).toBe(false)
    expect(isIsoDate(undefined)).toBe(false)
  })
  it('does Monday-based week math', () => {
    expect(weekdayIndex('2026-10-12')).toBe(0) // Monday
    expect(mondayOf('2026-10-18')).toBe('2026-10-12') // Sunday → previous Monday
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('falls back to UTC for an invalid timezone', () => {
    expect(localDateInTz(new Date('2026-10-12T23:30:00Z'), 'Not/AZone')).toBe('2026-10-12')
  })
})

describe('isFutureAndPending (shared guard)', () => {
  const today = '2026-10-12'
  it('accepts a future pending session and one scheduled today', () => {
    expect(isFutureAndPending({ scheduled_date: '2026-10-13', status: 'pending' }, today)).toBe(true)
    expect(isFutureAndPending({ scheduled_date: today, status: 'pending' }, today)).toBe(true)
  })
  it('rejects past sessions', () => {
    expect(isFutureAndPending({ scheduled_date: '2026-10-11', status: 'pending' }, today)).toBe(false)
  })
  it.each(['completed', 'skipped', 'modified'])('rejects a future %s session', (status) => {
    expect(isFutureAndPending({ scheduled_date: '2026-10-20', status }, today)).toBe(false)
  })
  it('applies the same predicate as a query filter', () => {
    const calls: [string, string, string][] = []
    const q = {
      gte(c: string, v: string) { calls.push(['gte', c, v]); return q },
      eq(c: string, v: string) { calls.push(['eq', c, v]); return q },
    }
    applyFutureAndPending(q, today)
    expect(calls).toEqual([
      ['gte', 'scheduled_date', today],
      ['eq', 'status', 'pending'],
    ])
  })
  it('timezone boundary: the same instant is "today" on different dates per athlete tz', () => {
    // 2026-10-12T23:30Z is already Oct 13 in Paris (UTC+2) but still Oct 12 in New York.
    const instant = new Date('2026-10-12T23:30:00Z')
    const paris = localDateInTz(instant, 'Europe/Paris')
    const ny = localDateInTz(instant, 'America/New_York')
    expect(paris).toBe('2026-10-13')
    expect(ny).toBe('2026-10-12')
    const session = { scheduled_date: '2026-10-12', status: 'pending' }
    expect(isFutureAndPending(session, paris)).toBe(false) // already past for Paris
    expect(isFutureAndPending(session, ny)).toBe(true) // still today for New York
  })
  it('getAthleteToday reads user_settings.timezone', async () => {
    const { client } = makeFakeSupabase({
      tables: { user_settings: [{ user_id: 'u1', timezone: 'Europe/Paris' }] },
    })
    const today = await getAthleteToday(client, 'u1', new Date('2026-10-12T23:30:00Z'))
    expect(today).toBe('2026-10-13')
    const none = await getAthleteToday(client, 'nobody', new Date('2026-10-12T23:30:00Z'))
    expect(none).toBe('2026-10-12') // UTC default
  })
})
