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
import { dayLabel, targetSummary, weekdayName, weekLabel } from '@/components/plan/plan-format'
import { buildRecapView } from '@/components/plan/recap-format'
import { computeTrainingRecap } from '@/lib/ai/workflows/training-recap'
import { sessionTypeLabel, sportLabel } from './labels'
import { formatDate, formatDistance, formatNumber, timeAgo } from '@/lib/utils'

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

describe('setUserLanguage without a settings row', () => {
  it('returns 404 and does not report success', async () => {
    const { client } = makeFakeSupabase({ rlsUserId: 'u1', tables: { user_settings: [] } })
    expect(await setUserLanguage(client, 'u1', 'fr')).toMatchObject({ ok: false, status: 404 })
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

describe('locale aware numbers, labels and recap', () => {
  it('formats numbers with a decimal comma in French and unchanged in English', () => {
    expect(formatDistance(10000)).toBe('10.00 km')
    expect(formatDistance(10500, 'metric', 'fr')).toBe('10,50 km')
    expect(formatNumber(3.25, 1, 'fr')).toBe('3,3')
    expect(formatNumber(3.25, 1)).toBe('3.3')
  })
  it('translates relative times', () => {
    const now = Date.now()
    expect(timeAgo(new Date(now - 3 * 3600_000))).toBe('3h ago')
    expect(timeAgo(new Date(now - 3 * 3600_000), undefined, 'fr')).toBe('il y a 3 h')
    expect(timeAgo(new Date(now), undefined, 'fr')).toBe("à l'instant")
  })
  it('translates sport and session labels, and keeps unknown values as stored', () => {
    const fr = makeT('fr')
    expect(sportLabel(fr, 'cycle')).toBe('Vélo')
    expect(sessionTypeLabel(fr, 'Long Run')).toBe('Sortie longue')
    expect(sessionTypeLabel(fr, 'hill repeats')).toBe('hill repeats')
    expect(sportLabel(makeT('en'), 'run')).toBe('Run')
  })
  it('targets and week labels follow the locale', () => {
    const s = { target_distance_m: 10500, target_duration_s: 3300, target_hr_zone: 2 }
    expect(targetSummary(s)).toBe('10.50 km · 55:00 · Zone 2')
    expect(targetSummary(s, 'fr')).toBe('10,50 km · 55:00 · Zone 2')
    expect(weekLabel('2026-10-12', '2026-10-18', 'fr')).toMatch(/12 oct\.? – 18 oct\.?/)
    expect(weekdayName(0, 'fr')).toBe('lundi')
    expect(weekdayName(0, 'en', 'short')).toBe('Mon')
  })
  it('builds the recap view in French', () => {
    const v = buildRecapView(computeTrainingRecap([], { timezone: 'UTC' }, '2026-10-12'), 'fr')
    expect(v.summary).toMatch(/^0 semaines sur 6 récentes utilisées/)
    expect(v.weeks[0].detail).toBe('Non utilisée : aucune activité')
    expect(v.facts[0].label).toBe('Volume hebdomadaire de départ')
    expect(v.notes).toContain('Aucune semaine éligible sur les 6 dernières semaines')
  })
})
