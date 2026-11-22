import { describe, it, expect } from 'vitest'
import {
  intlLocale,
  isLocale,
  localeFromAcceptLanguage,
  replyLanguageInstruction,
  resolveLocale,
  speechLang,
} from './locales'
import { en } from './dictionaries/en'
import { fr } from './dictionaries/fr'
import { interpolate, makeT } from './translate'
import { setUserLanguage } from './set-language'
import { makeFakeSupabase } from '@/lib/plan/__fixtures__/fake-supabase'
import { buildCoachSystemPrompt } from '@/lib/ai/prompts/coach'
import { buildSystemPrompt } from '@/lib/ai/workflows/generate-plan'
import { buildSummaryPrompt } from '@/lib/ai/chat-sessions/summarize'
import { dayLabel } from '@/components/plan/plan-format'
import { formatDate } from '@/lib/utils'

describe('resolveLocale', () => {
  it('prefers the saved preference over cookie and header', () => {
    expect(resolveLocale({ preference: 'fr', cookie: 'en', acceptLanguage: 'en-US' })).toBe('fr')
  })
  it('uses the cookie when there is no preference', () => {
    expect(resolveLocale({ preference: null, cookie: 'fr', acceptLanguage: 'en' })).toBe('fr')
  })
  it('uses Accept-Language on the first visit', () => {
    expect(resolveLocale({ acceptLanguage: 'fr-CA,fr;q=0.9,en;q=0.8' })).toBe('fr')
    expect(resolveLocale({ acceptLanguage: 'de-DE,de;q=0.9,fr;q=0.5' })).toBe('fr')
  })
  it('respects q-values and ignores unsupported languages', () => {
    expect(localeFromAcceptLanguage('fr;q=0.2,en;q=0.9')).toBe('en')
    expect(localeFromAcceptLanguage('de,es;q=0.5')).toBeNull()
    expect(localeFromAcceptLanguage('*')).toBeNull()
    expect(localeFromAcceptLanguage('fr;q=0')).toBeNull()
  })
  it('falls back to English and skips invalid values', () => {
    expect(resolveLocale({})).toBe('en')
    expect(resolveLocale({ preference: 'de', cookie: 'xx', acceptLanguage: '' })).toBe('en')
    expect(resolveLocale({ preference: 'de', cookie: 'fr' })).toBe('fr')
    expect(isLocale('FR')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
  })
  it('maps locales to Intl and speech tags', () => {
    expect(intlLocale('fr')).toBe('fr-FR')
    expect(speechLang('en')).toBe('en-US')
    expect(speechLang('fr')).toBe('fr-FR')
  })
})

describe('dictionaries', () => {
  it('have the same keys in en and fr', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort())
  })
  it('have no empty values and the same placeholders', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(fr[key].trim(), key).not.toBe('')
      expect(ph(fr[key]), key).toBe(ph(en[key]))
    }
  })
  it('translates and interpolates', () => {
    expect(makeT('fr')('nav.settings')).toBe('Réglages')
    expect(makeT('en')('coach.deleteChatAria', { title: 'Run' })).toBe('Delete chat Run')
    expect(interpolate('a {x} {y}', { x: 1 })).toBe('a 1 {y}')
  })
})

describe('setUserLanguage', () => {
  const setup = () =>
    makeFakeSupabase({ rlsUserId: 'u1', tables: { user_settings: [{ user_id: 'u1', language: 'en' }] } })
  it('rejects unsupported languages without writing', async () => {
    const { client, calls } = setup()
    for (const bad of ['de', '', null, 42, 'FR']) {
      expect(await setUserLanguage(client, 'u1', bad)).toMatchObject({ ok: false, status: 400 })
    }
    expect(calls.length).toBe(0)
  })
  it('saves en or fr', async () => {
    const { client, tables } = setup()
    expect(await setUserLanguage(client, 'u1', 'fr')).toEqual({ ok: true, language: 'fr' })
    expect(tables.user_settings.find((r) => r.user_id === 'u1')?.language).toBe('fr')
  })
})

describe('reply language in AI prompts', () => {
  const base = { profile: null, readiness: null, today: '2026-10-12' }
  const settings = (language: string) => ({ language }) as never
  it('coach prompt names the saved language', () => {
    expect(buildCoachSystemPrompt({ ...base, settings: settings('fr') })).toContain('Always reply in French')
    expect(buildCoachSystemPrompt({ ...base, settings: settings('en') })).toContain('Always reply in English')
    expect(buildCoachSystemPrompt({ ...base, settings: null })).toContain('Always reply in English')
  })
  it('plan and summary prompts carry the instruction', () => {
    expect(buildSystemPrompt('fr')).toContain('Always reply in French')
    expect(buildSystemPrompt()).toContain('Always reply in English')
    expect(buildSummaryPrompt([{ role: 'user', content: 'hi' }], 'fr').system).toContain('French')
  })
  it('keeps tool names and enum values unchanged', () => {
    expect(replyLanguageInstruction('fr')).toMatch(/tool names/)
    expect(replyLanguageInstruction('zz')).toContain('English')
  })
})

describe('locale aware date formats', () => {
  it('keeps English output and switches to French on request', () => {
    expect(dayLabel('2026-10-12')).toBe('Mon 12 Oct')
    expect(dayLabel('2026-10-12', 'fr')).toMatch(/lun\.? 12 oct/)
    expect(formatDate('2026-10-12T10:00:00Z', 'short', 'UTC')).toBe('12 Oct 2026')
    expect(formatDate('2026-10-12T10:00:00Z', 'long', 'UTC', 'fr')).toContain('octobre')
  })
})
