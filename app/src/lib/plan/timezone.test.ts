import { describe, it, expect } from 'vitest'
import { isValidTimeZone, resolveAthleteTimeZone, tzFromCookieHeader } from './timezone'

describe('resolveAthleteTimeZone', () => {
  it('prefers a valid cookie over the stored setting', () => {
    expect(resolveAthleteTimeZone({ cookieTz: 'Europe/Paris', settingsTz: 'Asia/Tokyo' })).toBe('Europe/Paris')
  })
  it('falls back to the setting when the cookie is garbage, empty or unknown', () => {
    for (const bad of ['%%%', '', 'Mars/Phobos', null, undefined]) {
      expect(resolveAthleteTimeZone({ cookieTz: bad, settingsTz: 'Asia/Tokyo' })).toBe('Asia/Tokyo')
    }
  })
  it('falls back to UTC when nothing is valid', () => {
    expect(resolveAthleteTimeZone({ cookieTz: 'Mars/Phobos', settingsTz: '' })).toBe('UTC')
    expect(resolveAthleteTimeZone({})).toBe('UTC')
  })
})

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects everything else', () => {
    expect(isValidTimeZone('Pacific/Auckland')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Mars/Phobos')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
    expect(isValidTimeZone(42)).toBe(false)
  })
})

describe('tzFromCookieHeader', () => {
  it('extracts and decodes the tz cookie', () => {
    expect(tzFromCookieHeader('a=1; tz=Europe%2FParis; b=2')).toBe('Europe/Paris')
  })
  it('returns null when absent or malformed', () => {
    expect(tzFromCookieHeader(null)).toBeNull()
    expect(tzFromCookieHeader('a=1')).toBeNull()
    expect(tzFromCookieHeader('tz=%E0%A4%A')).toBeNull()
  })
})
