import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isEmailAllowed, allowListEnabled } from './allow-list'

/**
 * Pins the login allow-list semantics: fail-OPEN when unset, exact +
 * case-insensitive match when set. These must survive refactors because they
 * gate who can sign in.
 */
describe('allow-list', () => {
  const original = process.env.ALLOWED_EMAILS

  beforeEach(() => {
    delete process.env.ALLOWED_EMAILS
  })
  afterEach(() => {
    if (original === undefined) delete process.env.ALLOWED_EMAILS
    else process.env.ALLOWED_EMAILS = original
  })

  it('is DISABLED (allows everyone) when ALLOWED_EMAILS is unset', () => {
    expect(allowListEnabled()).toBe(false)
    expect(isEmailAllowed('anyone@example.com')).toBe(true)
    expect(isEmailAllowed(null)).toBe(true)
  })

  it('is enabled and matches exact, case-insensitively, when set', () => {
    process.env.ALLOWED_EMAILS = 'a@example.com, B@Example.com'
    expect(allowListEnabled()).toBe(true)
    expect(isEmailAllowed('a@example.com')).toBe(true)
    expect(isEmailAllowed('A@EXAMPLE.COM')).toBe(true)
    expect(isEmailAllowed('b@example.com')).toBe(true)
    expect(isEmailAllowed('c@example.com')).toBe(false)
    expect(isEmailAllowed(null)).toBe(false)
    expect(isEmailAllowed(undefined)).toBe(false)
  })

  it('tolerates whitespace/newline separators in the list', () => {
    process.env.ALLOWED_EMAILS = ' a@example.com \n b@example.com '
    expect(isEmailAllowed('a@example.com')).toBe(true)
    expect(isEmailAllowed('b@example.com')).toBe(true)
  })
})
