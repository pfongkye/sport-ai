import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseOrsQuota, reportOrsQuota } from './quota'

const h = (o: Record<string, string>) => new Headers(o)

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('parseOrsQuota', () => {
  it('parses headers case-insensitively', () => {
    expect(
      parseOrsQuota(
        h({
          'X-RateLimit-Limit': '2000',
          'X-RateLimit-Remaining': '150',
          'X-RateLimit-Reset': '99',
        })
      )
    ).toEqual({ limit: 2000, remaining: 150, reset: '99' })
  })
  it('returns null when headers are missing or invalid', () => {
    expect(parseOrsQuota(h({}))).toBeNull()
    expect(
      parseOrsQuota(h({ 'x-ratelimit-limit': 'abc', 'x-ratelimit-remaining': '1' }))
    ).toBeNull()
    expect(parseOrsQuota(h({ 'x-ratelimit-limit': '0', 'x-ratelimit-remaining': '0' }))).toBeNull()
  })
})

describe('reportOrsQuota', () => {
  it('warns when remaining is under the default 10% threshold', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    reportOrsQuota(
      'directions',
      200,
      h({ 'x-ratelimit-limit': '2000', 'x-ratelimit-remaining': '100' })
    )
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain(
      '[ors-quota] low endpoint=directions remaining=100 limit=2000'
    )
  })
  it('stays silent above the threshold', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    reportOrsQuota(
      'directions',
      200,
      h({ 'x-ratelimit-limit': '2000', 'x-ratelimit-remaining': '1500' })
    )
    expect(warn).not.toHaveBeenCalled()
  })
  it('logs nothing without headers (self-hosted ORS)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    reportOrsQuota('geocode', 200, h({}))
    expect(warn).not.toHaveBeenCalled()
    expect(err).not.toHaveBeenCalled()
  })
  it('honors ORS_QUOTA_WARN_PCT', () => {
    vi.stubEnv('ORS_QUOTA_WARN_PCT', '50')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    reportOrsQuota(
      'directions',
      200,
      h({ 'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '40' })
    )
    expect(warn).toHaveBeenCalledTimes(1)
  })
  it('logs exhausted on 429, with or without headers', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    reportOrsQuota('directions', 429, h({}))
    expect(err.mock.calls[0][0]).toBe('[ors-quota] exhausted endpoint=directions')
  })
})
