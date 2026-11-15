import { describe, it, expect } from 'vitest'
import { setAthleteTimezone } from './set-timezone'
import { makeFakeSupabase } from './__fixtures__/fake-supabase'

const setup = (tz = 'UTC') =>
  makeFakeSupabase({ rlsUserId: 'u1', tables: { user_settings: [{ user_id: 'u1', timezone: tz }, { user_id: 'u2', timezone: 'UTC' }] } })

describe('setAthleteTimezone', () => {
  it('writes a valid new zone to the caller row only', async () => {
    const { client, tables } = setup()
    expect(await setAthleteTimezone(client, 'u1', 'Europe/Paris')).toEqual({ ok: true, timezone: 'Europe/Paris', changed: true })
    expect(tables.user_settings.find((r) => r.user_id === 'u1')?.timezone).toBe('Europe/Paris')
    expect(tables.user_settings.find((r) => r.user_id === 'u2')?.timezone).toBe('UTC')
  })
  it('rejects invalid zones without writing', async () => {
    const { client, calls } = setup()
    for (const bad of ['Mars/Phobos', '', null, 42]) {
      expect(await setAthleteTimezone(client, 'u1', bad)).toMatchObject({ ok: false, status: 400 })
    }
    expect(calls.some((c) => c.op === 'update')).toBe(false)
  })
  it('does not write when the zone is unchanged', async () => {
    const { client, calls } = setup('Europe/Paris')
    expect(await setAthleteTimezone(client, 'u1', 'Europe/Paris')).toEqual({ ok: true, timezone: 'Europe/Paris', changed: false })
    expect(calls.some((c) => c.op === 'update')).toBe(false)
  })
})
