import { describe, it, expect } from 'vitest'
import { isEditableUpcoming, applyEditableUpcoming, getAthleteToday } from './session-guard'
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

describe('isEditableUpcoming (shared guard)', () => {
  const today = '2026-10-12'
  it('accepts a future pending session and one scheduled today', () => {
    expect(isEditableUpcoming({ scheduled_date: '2026-10-13', status: 'pending' }, today)).toBe(true)
    expect(isEditableUpcoming({ scheduled_date: today, status: 'pending' }, today)).toBe(true)
  })
  it('rejects past sessions', () => {
    expect(isEditableUpcoming({ scheduled_date: '2026-10-11', status: 'pending' }, today)).toBe(false)
  })
  it.each(['completed', 'skipped'])('rejects a future %s session', (status) => {
    expect(isEditableUpcoming({ scheduled_date: '2026-10-20', status }, today)).toBe(false)
  })
  it('accepts a future or today modified (moved) session without an activity', () => {
    expect(isEditableUpcoming({ scheduled_date: '2026-10-20', status: 'modified' }, today)).toBe(true)
    expect(isEditableUpcoming({ scheduled_date: today, status: 'modified', completed_activity_id: null }, today)).toBe(true)
  })
  it('rejects a past modified session', () => {
    expect(isEditableUpcoming({ scheduled_date: '2026-10-11', status: 'modified' }, today)).toBe(false)
  })
  it.each(['pending', 'modified', 'completed'])('rejects a %s session that has a completed activity', (status) => {
    expect(isEditableUpcoming({ scheduled_date: '2026-10-20', status, completed_activity_id: 'act-1' }, today)).toBe(false)
  })
  it('applies the same predicate as a query filter', () => {
    const calls: [string, string, unknown][] = []
    const q = {
      gte(c: string, v: string) { calls.push(['gte', c, v]); return q },
      in(c: string, v: readonly string[]) { calls.push(['in', c, [...v]]); return q },
      is(c: string, v: null) { calls.push(['is', c, v]); return q },
    }
    applyEditableUpcoming(q, today)
    expect(calls).toEqual([
      ['gte', 'scheduled_date', today],
      ['in', 'status', ['pending', 'modified']],
      ['is', 'completed_activity_id', null],
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
    expect(isEditableUpcoming(session, paris)).toBe(false) // already past for Paris
    expect(isEditableUpcoming(session, ny)).toBe(true) // still today for New York
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

describe('athlete "today" at the day boundary', () => {
  const at = (iso: string, tz: string) => localDateInTz(new Date(iso), tz)
  it('Pacific/Auckland (UTC+13) is a day ahead of UTC from 11:00Z', () => {
    expect(at('2026-01-15T10:59:00Z', 'Pacific/Auckland')).toBe('2026-01-15')
    expect(at('2026-01-15T11:00:00Z', 'Pacific/Auckland')).toBe('2026-01-16')
  })
  it('Pacific/Honolulu (UTC-10) is still the previous day until 10:00Z', () => {
    expect(at('2026-01-15T09:59:00Z', 'Pacific/Honolulu')).toBe('2026-01-14')
    expect(at('2026-01-15T10:00:00Z', 'Pacific/Honolulu')).toBe('2026-01-15')
  })
  it('Europe/Paris rolls over at local midnight across both DST changes', () => {
    // Autumn (2026-10-25, CEST→CET at 01:00Z): midnight is 22:00Z before, 23:00Z after.
    expect(at('2026-10-24T21:59:00Z', 'Europe/Paris')).toBe('2026-10-24')
    expect(at('2026-10-24T22:00:00Z', 'Europe/Paris')).toBe('2026-10-25')
    expect(at('2026-10-25T22:59:00Z', 'Europe/Paris')).toBe('2026-10-25')
    expect(at('2026-10-25T23:00:00Z', 'Europe/Paris')).toBe('2026-10-26')
    // Spring (2026-03-29, CET→CEST at 01:00Z).
    expect(at('2026-03-28T22:59:00Z', 'Europe/Paris')).toBe('2026-03-28')
    expect(at('2026-03-28T23:00:00Z', 'Europe/Paris')).toBe('2026-03-29')
    expect(at('2026-03-29T21:59:00Z', 'Europe/Paris')).toBe('2026-03-29')
    expect(at('2026-03-29T22:00:00Z', 'Europe/Paris')).toBe('2026-03-30')
  })
  it('getAthleteToday: a valid cookie zone wins over the stored zone', async () => {
    const { client } = makeFakeSupabase({
      tables: { user_settings: [{ user_id: 'u1', timezone: 'UTC' }] },
    })
    const now = new Date('2026-01-15T11:30:00Z')
    expect(await getAthleteToday(client, 'u1', now)).toBe('2026-01-15')
    expect(await getAthleteToday(client, 'u1', now, 'Pacific/Auckland')).toBe('2026-01-16')
    expect(await getAthleteToday(client, 'u1', now, 'Mars/Phobos')).toBe('2026-01-15')
  })
  it('the editable guard follows the passed zone', async () => {
    const { client } = makeFakeSupabase({ tables: { user_settings: [] } })
    const now = new Date('2026-01-15T11:30:00Z')
    const session = { scheduled_date: '2026-01-15', status: 'pending' }
    const auckland = await getAthleteToday(client, 'u1', now, 'Pacific/Auckland')
    const honolulu = await getAthleteToday(client, 'u1', now, 'Pacific/Honolulu')
    expect(isEditableUpcoming(session, auckland)).toBe(false)
    expect(isEditableUpcoming(session, honolulu)).toBe(true)
  })
})
